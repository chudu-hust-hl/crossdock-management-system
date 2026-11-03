import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { BusinessCodeType } from '../../common/enums/business-code-type.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { buildSort, findPage, Page } from '../../common/utils/pagination.util';
import { containsIgnoringCase } from '../../common/utils/text-filter.util';
import { generateUlid } from '../../common/utils/ulid.util';
import { CreateItemDto } from '../items/dto/create-item.dto';
import { ItemsService } from '../items/items.service';
import { LocationStatus } from '../locations/enums/location-status.enum';
import { LocationsService } from '../locations/locations.service';
import { Location } from '../locations/schemas/location.schema';
import { MetadataService } from '../metadata/metadata.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { ShipmentEndpointDto } from './dto/shipment-endpoint.dto';
import { DeliveryInfo } from './schemas/delivery-info.schema';
import { Shipment } from './schemas/shipment.schema';
import { ShipmentCostService } from './shipment-cost.service';

type EndpointName = 'pickup' | 'dropoff';

/** What a booking has written so far, so that a failure can undo exactly that. */
interface BookingWrites {
  createdLocationIds: string[];
  createdItemIds: string[];
}

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
    private readonly locationsService: LocationsService,
    private readonly itemsService: ItemsService,
    private readonly metadataService: MetadataService,
    private readonly costService: ShipmentCostService,
  ) {}

  /**
   * Books a root shipment (docs/business-workflows.md §4). Every item is created by
   * this booking; Items are never reused. MongoDB transactions are not available on
   * the standalone server, so:
   * 1. every check that writes nothing runs first;
   * 2. the writes follow, with the Shipment itself last;
   * 3. if a write fails, the writes already done by this booking are undone.
   */
  async create(dto: CreateShipmentDto): Promise<Shipment> {
    await this.checkBarcodesAreFree(dto.items);
    const cost = this.costService.calculate(dto.items);

    const shipmentId = generateUlid();
    const writes: BookingWrites = {
      createdLocationIds: [],
      createdItemIds: [],
    };
    try {
      const pickup = await this.resolveEndpoint(dto.pickup, 'pickup', writes);
      const dropoff = await this.resolveEndpoint(
        dto.dropoff,
        'dropoff',
        writes,
      );
      if (pickup.id === dropoff.id) {
        throw new BadRequestException(
          `pickup and dropoff are the same Location (${pickup.id})`,
        );
      }

      const now = new Date();
      const code = await this.metadataService.nextBusinessCode(
        BusinessCodeType.SHIPMENT,
        now,
      );
      const itemCodes = await this.metadataService.nextBusinessCodes(
        BusinessCodeType.ITEM,
        now,
        dto.items.length,
      );
      // Recorded before inserting, so that a partly failed insert is cleaned up too.
      writes.createdItemIds = dto.items.map(() => generateUlid());
      await this.itemsService.createMany(
        dto.items.map((item, index) => ({
          ...item,
          id: writes.createdItemIds[index],
          itemCode: itemCodes[index],
          currentLocationId: pickup.id,
          currentShipmentId: shipmentId,
        })),
      );

      const shipment = await this.shipmentModel.create({
        id: shipmentId,
        code,
        customerName: dto.customerName,
        cost,
        parentId: null,
        itemIds: writes.createdItemIds,
        deliveryInfos: [
          deliveryInfo(1, pickup, DeliveryPointType.PICKUP, dto.pickup),
          deliveryInfo(2, dropoff, DeliveryPointType.DROPOFF, dto.dropoff),
        ],
        metadata: dto.metadata,
      });
      return shipment.toObject();
    } catch (error) {
      await this.undo(writes);
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A unique value (e.g. an item barcode) was taken by another request at the same time; nothing was booked',
        );
      }
      throw error;
    }
  }

  findAll(query: ListShipmentsQueryDto): Promise<Page<Shipment>> {
    return findPage(
      this.shipmentModel,
      this.buildListFilter(query),
      this.buildListSort(query),
      query,
    );
  }

  async findById(id: string): Promise<Shipment> {
    const shipment = await this.shipmentModel
      .findOne({ id, deletedAt: null })
      .lean<Shipment>()
      .exec();
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    return shipment;
  }

  /** The MongoDB filter of a Shipment list; soft-deleted Shipments never match. */
  buildListFilter(query: ListShipmentsQueryDto): FilterQuery<Shipment> {
    if (query.isRoot === true && query.parentId) {
      throw new BadRequestException(
        'parentId cannot be combined with isRoot=true: a root shipment has no parent',
      );
    }
    return {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.code && { code: containsIgnoringCase(query.code) }),
      ...(query.customerName && {
        customerName: containsIgnoringCase(query.customerName),
      }),
      ...(query.isRoot !== undefined && {
        parentId: query.isRoot ? null : { $ne: null },
      }),
      ...(query.parentId && { parentId: query.parentId }),
      ...(query.itemId && { itemIds: query.itemId }),
      ...(query.locationId && {
        'deliveryInfos.locationId': query.locationId,
      }),
    };
  }

  buildListSort(query: ListShipmentsQueryDto): Record<string, SortOrder> {
    return buildSort(query.sortBy, query.sortOrder);
  }

  private async checkBarcodesAreFree(items: CreateItemDto[]): Promise<void> {
    const used = await this.itemsService.findUsedBarcodes(
      items.map((item) => item.barcode),
    );
    if (used.length > 0) {
      throw new ConflictException(
        `Barcodes already registered: ${used.join(', ')}`,
      );
    }
  }

  /** Reuses the matching STORE or creates one; a shipment may only use an ACTIVE Location. */
  private async resolveEndpoint(
    endpoint: ShipmentEndpointDto,
    name: EndpointName,
    writes: BookingWrites,
  ): Promise<Location> {
    const { location, created } = await this.locationsService.resolveCandidate(
      endpoint.location,
    );
    if (created) {
      writes.createdLocationIds.push(location.id);
    }
    if (location.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException(
        `${name} Location ${location.id} is ${location.status}`,
      );
    }
    return location;
  }

  /**
   * Undoes a failed booking's writes, newest first. Every step runs even if an
   * earlier one fails; failures are logged, and the original error is reported.
   */
  private async undo(writes: BookingWrites): Promise<void> {
    await this.attempt(`remove created items`, () =>
      this.itemsService.removeCreatedForRollback(writes.createdItemIds),
    );
    for (const locationId of writes.createdLocationIds) {
      await this.attempt(`remove created Location ${locationId}`, () =>
        this.removeLocationIfUnused(locationId),
      );
    }
  }

  /** A concurrent booking may have reused the new store; then it is kept. */
  private async removeLocationIfUnused(locationId: string): Promise<void> {
    const usedByShipment = await this.shipmentModel.exists({
      'deliveryInfos.locationId': locationId,
    });
    if (
      usedByShipment ||
      (await this.itemsService.isAnyAtLocation(locationId))
    ) {
      return;
    }
    await this.locationsService.removeCreatedForRollback(locationId);
  }

  private async attempt(
    description: string,
    step: () => Promise<void>,
  ): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.error(
        `Booking rollback step failed (${description}): ${String(error)}`,
      );
    }
  }
}

function deliveryInfo(
  sequence: number,
  location: Location,
  type: DeliveryPointType,
  endpoint: ShipmentEndpointDto,
): Partial<DeliveryInfo> {
  return {
    sequence,
    locationId: location.id,
    type,
    appointment: {
      from: endpoint.appointment.from,
      to: endpoint.appointment.to,
    },
  };
}
