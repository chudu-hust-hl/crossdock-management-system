import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { TimeWindowDto } from '../../common/dto/time-window.dto';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { UpdateItemDto } from '../items/dto/update-item.dto';
import { ItemsService } from '../items/items.service';
import { Item } from '../items/schemas/item.schema';
import { RoutesService } from '../routes/routes.service';
import { ShipmentView } from './dto/shipment-view-response.dto';
import { UpdateAppointmentsDto } from './dto/update-appointments.dto';
import { UpdateShipmentCustomerDto } from './dto/update-shipment-customer.dto';
import { ShipmentStatus } from './enums/shipment-status.enum';
import { Shipment } from './schemas/shipment.schema';
import { ShipmentCostService } from './shipment-cost.service';
import { ShipmentsService } from './shipments.service';

type AppointmentWindow = { from: Date; to: Date };

/**
 * Corrections of a booking while it is still `CREATED` (docs/business-workflows.md §7):
 * the customer name, the two store appointments, and a booked item. A child id is
 * `404`; any other status is `409`. Without transactions, the writes run in a fixed
 * order and every root write repeats the `CREATED` condition.
 */
@Injectable()
export class ShipmentEditsService {
  constructor(
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
    private readonly shipmentsService: ShipmentsService,
    private readonly itemsService: ItemsService,
    private readonly routesService: RoutesService,
    private readonly costService: ShipmentCostService,
  ) {}

  async updateCustomer(
    id: string,
    dto: UpdateShipmentCustomerDto,
  ): Promise<Shipment> {
    await this.findEditableRoot(id);
    return this.updateEditableRoot(id, {
      $set: { customerName: dto.customerName },
    });
  }

  /**
   * Writes the pickup window onto the root's PICKUP point and onto point 1 of the child
   * that starts at that store; the drop-off window onto the root's DROPOFF point and
   * onto point 2 of the child that ends at that store. Those children's dedicated
   * routes get the same window. Dock–dock routes keep their slot window.
   */
  async updateAppointments(
    id: string,
    dto: UpdateAppointmentsDto,
  ): Promise<ShipmentView> {
    const errors = appointmentOrderErrors(dto);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
    const root = await this.findEditableRoot(id);
    const pickup = root.deliveryInfos.find(
      (info) => info.type === DeliveryPointType.PICKUP,
    );
    const dropoff = root.deliveryInfos.find(
      (info) => info.type === DeliveryPointType.DROPOFF,
    );
    if (!pickup || !dropoff) {
      throw new Error(`Booking ${id} has no PICKUP or DROPOFF point`);
    }

    await this.updateEditableRoot(
      id,
      {
        $set: {
          'deliveryInfos.$[pickup].appointment': toWindow(dto.pickup),
          'deliveryInfos.$[dropoff].appointment': toWindow(dto.dropoff),
        },
      },
      [
        { 'pickup.type': DeliveryPointType.PICKUP },
        { 'dropoff.type': DeliveryPointType.DROPOFF },
      ],
    );

    const children = await this.shipmentsService.findChildren(root);
    await this.updateChildEnd(children, 1, pickup.locationId, dto.pickup);
    await this.updateChildEnd(children, 2, dropoff.locationId, dto.dropoff);
    return this.shipmentsService.findView(id);
  }

  /**
   * Corrects one booked item, then recalculates the root cost from all its items and
   * rewrites the item's snapshot rows on the routes of the root's children.
   */
  async updateItem(
    id: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<ShipmentView> {
    const root = await this.findEditableRoot(id);
    if (!root.itemIds.includes(itemId)) {
      throw new NotFoundException(
        `Item ${itemId} is not on booking ${root.code}`,
      );
    }

    // The cost is calculated before any write, so missing pricing (503) changes nothing.
    const items = await this.itemsService.findByIds(root.itemIds);
    const cost = this.costService.calculate(
      items.map((item) =>
        item.id === itemId ? withWeightChanges(item, dto) : item,
      ),
    );

    const item = await this.itemsService.correct(itemId, dto);
    await this.updateEditableRoot(id, { $set: { cost } });
    await this.routesService.updateItemSnapshots(root.childrenIds, item);
    return this.shipmentsService.findView(id);
  }

  private async findEditableRoot(id: string): Promise<Shipment> {
    const root = await this.shipmentsService.findRootById(id);
    if (root.status !== ShipmentStatus.CREATED) {
      throw new ConflictException(
        `Booking ${root.code} is ${root.status}; the booking can no longer be edited`,
      );
    }
    return root;
  }

  /** Updates the root only while it is still `CREATED`; otherwise `409`. */
  private async updateEditableRoot(
    id: string,
    update: UpdateQuery<Shipment>,
    arrayFilters?: Record<string, unknown>[],
  ): Promise<Shipment> {
    const updated = await this.shipmentModel
      .findOneAndUpdate(
        {
          id,
          parentId: null,
          deletedAt: null,
          status: ShipmentStatus.CREATED,
        },
        update,
        { new: true, runValidators: true, arrayFilters },
      )
      .lean<Shipment>()
      .exec();
    if (!updated) {
      throw new ConflictException(
        `Booking ${id} changed status; the booking can no longer be edited`,
      );
    }
    return updated;
  }

  /**
   * The child whose point `sequence` is this store (A → A' for the pickup, B' → B for
   * the drop-off) gets the window there, and so does its dedicated route.
   */
  private async updateChildEnd(
    children: Shipment[],
    sequence: 1 | 2,
    storeLocationId: string,
    appointment: TimeWindowDto,
  ): Promise<void> {
    const child = children.find((candidate) =>
      candidate.deliveryInfos.some(
        (info) =>
          info.sequence === sequence && info.locationId === storeLocationId,
      ),
    );
    if (!child) {
      return;
    }
    await this.shipmentModel
      .updateOne(
        { id: child.id, deletedAt: null },
        { $set: { 'deliveryInfos.$[end].appointment': toWindow(appointment) } },
        { arrayFilters: [{ 'end.sequence': sequence }], runValidators: true },
      )
      .exec();
    await this.routesService.setDedicatedRouteAppointment(
      child.id,
      storeLocationId,
      toWindow(appointment),
    );
  }
}

/** Each window must have `from` before `to`; the pickup must end by the drop-off start. */
export function appointmentOrderErrors(dto: UpdateAppointmentsDto): string[] {
  const errors: string[] = [];
  for (const name of ['pickup', 'dropoff'] as const) {
    if (dto[name].from.getTime() >= dto[name].to.getTime()) {
      errors.push(`${name}.from must be before ${name}.to`);
    }
  }
  if (dto.pickup.to.getTime() > dto.dropoff.from.getTime()) {
    errors.push('pickup.to must not be later than dropoff.from');
  }
  return errors;
}

function toWindow(dto: TimeWindowDto): AppointmentWindow {
  return { from: dto.from, to: dto.to };
}

/** The item as the cost formula will see it after the correction. */
function withWeightChanges(item: Item, dto: UpdateItemDto): Item {
  return {
    ...item,
    weight: dto.weight ?? item.weight,
    weightUnit: dto.weightUnit ?? item.weightUnit,
  };
}
