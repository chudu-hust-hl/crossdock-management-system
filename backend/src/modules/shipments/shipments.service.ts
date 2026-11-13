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
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
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
import { RoutedChild, RoutesService } from '../routes/routes.service';
import { RoutingResult, RoutingService } from '../routing/routing.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { ShipmentEndpointDto } from './dto/shipment-endpoint.dto';
import { ShipmentSummaryPage } from './dto/shipment-summary-response.dto';
import { ShipmentView } from './dto/shipment-view-response.dto';
import { ShipmentStatus } from './enums/shipment-status.enum';
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
    private readonly routingService: RoutingService,
    private readonly routesService: RoutesService,
  ) {}

  /**
   * Books a root shipment (docs/business-workflows.md §4) and then routes it (§5).
   * Every item is created by this booking; Items are never reused. MongoDB
   * transactions are not available on the standalone server, so:
   * 1. every check that writes nothing runs first;
   * 2. the writes follow, with the Shipment itself last;
   * 3. if a write fails, the writes already done by this booking are undone.
   * Routing, child shipments, and route assignment run after that shipment exists.
   * They are not part of the undo.
   */
  async create(dto: CreateShipmentDto): Promise<RoutingResult> {
    await this.checkBarcodesAreFree(dto.items);
    const cost = this.costService.calculate(dto.items);

    const shipmentId = generateUlid();
    const writes: BookingWrites = {
      createdLocationIds: [],
      createdItemIds: [],
    };
    let shipment: Shipment;
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

      shipment = (
        await this.shipmentModel.create({
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
        })
      ).toObject();
    } catch (error) {
      await this.undo(writes);
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A unique value (e.g. an item barcode) was taken by another request at the same time; nothing was booked',
        );
      }
      throw error;
    }

    const routed = await this.routingService.route(shipment);
    if (routed.routingStoppedReason) {
      return routed;
    }
    const booked = await this.createChildShipments(routed.shipment);
    await this.routesService.assignForBooking(booked.shipment, booked.children);
    return { shipment: booked.shipment };
  }

  /**
   * One child shipment per hop of the root's routed path (docs/business-workflows.md §5).
   * `childrenIds` is written only after every child insert succeeds. Items are not created.
   */
  private async createChildShipments(root: Shipment): Promise<{
    shipment: Shipment;
    children: RoutedChild[];
  }> {
    const hops = hopsInPathOrder(root.deliveryInfos);
    if (hops.length === 0) {
      return { shipment: root, children: [] };
    }

    const codes = await this.metadataService.nextBusinessCodes(
      BusinessCodeType.SHIPMENT,
      new Date(),
      hops.length,
    );
    const children = hops.map(([from, to], index) => ({
      id: generateUlid(),
      code: codes[index],
      parentId: root.id,
      itemIds: [...root.itemIds],
      status: ShipmentStatus.CREATED,
      deliveryInfos: [childPoint(1, from), childPoint(2, to)],
    }));

    await this.shipmentModel.insertMany(children, { ordered: true });

    const doc = await this.shipmentModel.findOne({
      id: root.id,
      deletedAt: null,
    });
    if (!doc) {
      throw new Error(
        `Shipment ${root.id} was not found when its child shipments were listed`,
      );
    }
    doc.childrenIds = children.map((child) => child.id);
    await doc.save();
    return { shipment: doc.toObject(), children };
  }

  findAll(query: ListShipmentsQueryDto): Promise<Page<Shipment>> {
    return findPage(
      this.shipmentModel,
      this.buildListFilter(query),
      this.buildListSort(query),
      query,
    );
  }

  /**
   * A page of shipments with the stores and Items its rows show. Two batch queries
   * for the whole page, not one per row: the PICKUP/DROPOFF Locations and the Items.
   */
  async findSummaryPage(
    query: ListShipmentsQueryDto,
  ): Promise<ShipmentSummaryPage> {
    const page = await this.findAll(query);
    const locationIds = page.items.flatMap((shipment) =>
      shipment.deliveryInfos
        .filter((info) => info.type !== DeliveryPointType.TRANSIT)
        .map((info) => info.locationId),
    );
    const itemIds = page.items.flatMap((shipment) => shipment.itemIds);
    const [locations, items] = await Promise.all([
      this.locationsService.findSummariesByIds(unique(locationIds)),
      this.itemsService.findSummariesByIds(unique(itemIds)),
    ]);
    return { page, locations, items };
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

  /** A non-deleted root shipment (booking). A child id is `404`, like an unknown id. */
  async findRootById(id: string): Promise<Shipment> {
    const shipment = await this.shipmentModel
      .findOne({ id, parentId: null, deletedAt: null })
      .lean<Shipment>()
      .exec();
    if (!shipment) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
    return shipment;
  }

  /**
   * One booking with its Locations, Items, children and routes, in five queries by
   * indexed fields (no populate): the root by `id`, its children by `parentId`, the
   * Items, Locations and routes by `$in`.
   */
  async findView(id: string): Promise<ShipmentView> {
    const shipment = await this.findRootById(id);
    const [children, items, routes] = await Promise.all([
      this.findChildren(shipment),
      this.itemsService.findByIds(shipment.itemIds),
      this.routesService.findForShipments(shipment.childrenIds),
    ]);
    const locationIds = [shipment, ...children].flatMap((s) =>
      s.deliveryInfos.map((info) => info.locationId),
    );
    const locations = await this.locationsService.findByIds(
      unique(locationIds),
    );
    return {
      shipment,
      locations,
      items: inIdOrder(items, shipment.itemIds),
      children,
      routes,
    };
  }

  /** The children listed in `childrenIds`, in that order. */
  async findChildren(root: Shipment): Promise<Shipment[]> {
    if (root.childrenIds.length === 0) {
      return [];
    }
    const children = await this.shipmentModel
      .find({ parentId: root.id, deletedAt: null })
      .lean<Shipment[]>()
      .exec();
    return inIdOrder(children, root.childrenIds);
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

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** The documents in the order of `ids`; an id without a document is skipped. */
function inIdOrder<T extends { id: string }>(
  documents: T[],
  ids: string[],
): T[] {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return ids
    .map((id) => byId.get(id))
    .filter((document): document is T => document !== undefined);
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

/** Consecutive stops, in sequence order. A hop from a location to itself is skipped. */
function hopsInPathOrder(
  deliveryInfos: DeliveryInfo[],
): Array<[DeliveryInfo, DeliveryInfo]> {
  const ordered = [...deliveryInfos].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const hops: Array<[DeliveryInfo, DeliveryInfo]> = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (from.locationId !== to.locationId) {
      hops.push([from, to]);
    }
  }
  return hops;
}

/**
 * One end of a child shipment. A pickup or drop-off keeps the root appointment.
 * A transit point does not: both of its windows stay empty.
 */
function childPoint(sequence: number, point: DeliveryInfo): DeliveryInfo {
  const empty = { from: null, to: null };
  const keepsAppointment =
    point.type === DeliveryPointType.PICKUP ||
    point.type === DeliveryPointType.DROPOFF;
  return {
    sequence,
    locationId: point.locationId,
    type: point.type,
    status: DeliveryPointStatus.PENDING,
    appointment: keepsAppointment
      ? { from: point.appointment.from, to: point.appointment.to }
      : empty,
    actualWindow: { from: null, to: null },
  };
}
