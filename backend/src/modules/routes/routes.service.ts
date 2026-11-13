import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { BusinessCodeType } from '../../common/enums/business-code-type.enum';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { ItemsService } from '../items/items.service';
import { Item } from '../items/schemas/item.schema';
import { LocationType } from '../locations/enums/location-type.enum';
import { LocationsService } from '../locations/locations.service';
import { MetadataService } from '../metadata/metadata.service';
import { DeliveryInfo } from '../shipments/schemas/delivery-info.schema';
import { Shipment } from '../shipments/schemas/shipment.schema';
import { RouteStatus } from './enums/route-status.enum';
import {
  ROUTE_CREATED_BY,
  ROUTE_DRIVER_NAME,
  ROUTE_VEHICLE_PLATE,
} from './route-assignment.constants';
import { RouteItem } from './schemas/route-item.schema';
import { Route, RouteDocument } from './schemas/route.schema';
import { RouteStop } from './schemas/route-stop.schema';
import * as trunkSlot from './trunk-slot';

/** A child shipment, as `createChildShipments` returns it. */
export type RoutedChild = Pick<
  Shipment,
  'id' | 'parentId' | 'itemIds' | 'deliveryInfos'
>;

/** How far to walk when each slot already holds a route that has left `PLANNED`. */
const MAX_SLOT_ATTEMPTS = 48;

@Injectable()
export class RoutesService {
  constructor(
    @InjectModel(Route.name)
    private readonly routeModel: Model<Route>,
    private readonly locationsService: LocationsService,
    private readonly itemsService: ItemsService,
    private readonly metadataService: MetadataService,
  ) {}

  /**
   * Places each child on a route (docs/business-workflows.md §5).
   * The root is never listed. A child already on a non-deleted route is skipped.
   * Nothing is written when there are no children. A failure does not undo the booking.
   */
  async assignForBooking(
    root: Shipment,
    children: RoutedChild[],
  ): Promise<void> {
    if (children.length === 0) {
      return;
    }
    const bookedAt = trunkSlot.bookingNow();
    for (const child of children) {
      if (child.id === root.id) {
        continue;
      }
      await this.assignChild(child, bookedAt);
    }
  }

  /** Non-deleted routes that carry at least one of these child shipments, oldest first. */
  async findForShipments(shipmentIds: string[]): Promise<Route[]> {
    if (shipmentIds.length === 0) {
      return [];
    }
    return this.routeModel
      .find({ shipmentIds: { $in: shipmentIds }, deletedAt: null })
      .sort({ createdAt: 1, id: 1 })
      .lean<Route[]>()
      .exec();
  }

  /**
   * Gives the dedicated route of a store–dock child (the route without a `slot`) a new
   * appointment: the route itself and its stop at the store. A dock–dock route has a
   * `slot`, so it never matches and keeps its slot window. `actualWindow` and the stop
   * status are not touched.
   */
  async setDedicatedRouteAppointment(
    shipmentId: string,
    storeLocationId: string,
    appointment: { from: Date; to: Date },
  ): Promise<void> {
    await this.routeModel
      .updateOne(
        { shipmentIds: shipmentId, slot: { $exists: false }, deletedAt: null },
        {
          $set: {
            appointment,
            'stops.$[store].appointment': appointment,
          },
        },
        {
          arrayFilters: [{ 'store.locationId': storeLocationId }],
          runValidators: true,
        },
      )
      .exec();
  }

  /**
   * After a booked item was corrected, rewrites its snapshot rows on every non-deleted
   * route carrying one of these child shipments. `itemCode` and `barcode` stay as copied.
   */
  async updateItemSnapshots(shipmentIds: string[], item: Item): Promise<void> {
    if (shipmentIds.length === 0) {
      return;
    }
    if (item.weight == null || !item.weightUnit) {
      throw new Error(`Item ${item.id} has no weight for its route snapshot`);
    }
    const update: UpdateQuery<Route> = {
      $set: {
        'items.$[row].itemUnit': item.itemUnit,
        'items.$[row].weight': item.weight,
        'items.$[row].weightUnit': item.weightUnit,
        ...(item.description
          ? { 'items.$[row].description': item.description }
          : {}),
      },
    };
    if (!item.description) {
      update.$unset = { 'items.$[row].description': 1 };
    }
    await this.routeModel
      .updateMany(
        { shipmentIds: { $in: shipmentIds }, deletedAt: null },
        update,
        { arrayFilters: [{ 'row.itemId': item.id }], runValidators: true },
      )
      .exec();
  }

  private async assignChild(child: RoutedChild, bookedAt: Date): Promise<void> {
    const alreadyAssigned = await this.routeModel.exists({
      shipmentIds: child.id,
      deletedAt: null,
    });
    if (alreadyAssigned) {
      return;
    }

    const [origin, destination] = endsOf(child);
    const [originLocation, destinationLocation] = await Promise.all([
      this.locationsService.findById(origin.locationId),
      this.locationsService.findById(destination.locationId),
    ]);
    const snapshots = await this.snapshotsFor(child);
    const types = new Set([originLocation.type, destinationLocation.type]);

    if (types.has(LocationType.STORE) && types.has(LocationType.CROSS_DOCK)) {
      const storePoint =
        originLocation.type === LocationType.STORE ? origin : destination;
      await this.createRoute({
        shipmentIds: [child.id],
        items: snapshots,
        stops: [stopFrom(origin, child.id), stopFrom(destination, child.id)],
        fromLocationId: origin.locationId,
        toLocationId: destination.locationId,
        appointment: {
          from: storePoint.appointment.from,
          to: storePoint.appointment.to,
        },
        bookedAt,
      });
      return;
    }

    if (
      originLocation.type === LocationType.CROSS_DOCK &&
      destinationLocation.type === LocationType.CROSS_DOCK
    ) {
      await this.joinTrunk(child.id, origin, destination, snapshots, bookedAt);
    }
  }

  private async joinTrunk(
    childId: string,
    origin: DeliveryInfo,
    destination: DeliveryInfo,
    snapshots: RouteItem[],
    bookedAt: Date,
  ): Promise<void> {
    let slot = trunkSlot.trunkSlotFor(bookedAt);
    for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt += 1) {
      const placed = await this.placeOnTrunk(
        childId,
        origin,
        destination,
        snapshots,
        slot,
        bookedAt,
      );
      if (placed) {
        return;
      }
      slot = trunkSlot.nextTrunkSlot(slot);
    }
    throw new Error(
      `No planned dock-dock route is open for shipment ${childId}`,
    );
  }

  /**
   * Appends to the planned route for this lane, or creates it.
   * Returns false when that slot exists but is no longer `PLANNED`.
   */
  private async placeOnTrunk(
    childId: string,
    origin: DeliveryInfo,
    destination: DeliveryInfo,
    snapshots: RouteItem[],
    slot: trunkSlot.TrunkSlot,
    bookedAt: Date,
  ): Promise<boolean> {
    const key = {
      fromLocationId: origin.locationId,
      toLocationId: destination.locationId,
      serviceDate: slot.serviceDate,
      slot: slot.slot,
      deletedAt: null,
    };
    const existing = await this.routeModel.findOne(key);
    if (existing) {
      if (existing.status !== RouteStatus.PLANNED) {
        return false;
      }
      await this.appendChild(existing, childId, snapshots);
      return true;
    }

    try {
      await this.createRoute({
        shipmentIds: [childId],
        items: snapshots,
        stops: [
          transitStop(1, origin.locationId, childId),
          transitStop(2, destination.locationId, childId),
        ],
        fromLocationId: origin.locationId,
        toLocationId: destination.locationId,
        serviceDate: slot.serviceDate,
        slot: slot.slot,
        appointment: slot.appointment,
        bookedAt,
      });
      return true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const winner = await this.routeModel.findOne(key);
      if (!winner || winner.status !== RouteStatus.PLANNED) {
        return false;
      }
      await this.appendChild(winner, childId, snapshots);
      return true;
    }
  }

  private async appendChild(
    route: RouteDocument,
    childId: string,
    snapshots: RouteItem[],
  ): Promise<void> {
    if (!route.shipmentIds.includes(childId)) {
      route.shipmentIds.push(childId);
    }
    for (const stop of route.stops) {
      if (!stop.shipmentIds.includes(childId)) {
        stop.shipmentIds.push(childId);
      }
    }
    for (const snapshot of snapshots) {
      const duplicate = route.items.some(
        (item) =>
          item.itemId === snapshot.itemId &&
          item.shipmentId === snapshot.shipmentId,
      );
      if (!duplicate) {
        route.items.push(snapshot);
      }
    }
    assertStopsInsideRoute(route);
    route.markModified('shipmentIds');
    route.markModified('stops');
    route.markModified('items');
    await route.save();
  }

  private async createRoute(input: {
    shipmentIds: string[];
    items: RouteItem[];
    stops: RouteStop[];
    fromLocationId: string;
    toLocationId: string;
    serviceDate?: string;
    slot?: trunkSlot.TrunkSlot['slot'];
    appointment: { from: Date | null; to: Date | null };
    bookedAt: Date;
  }): Promise<void> {
    assertStopsInsideRoute(input);
    const routeNumber = await this.metadataService.nextBusinessCode(
      BusinessCodeType.ROUTE,
      input.bookedAt,
    );
    await this.routeModel.create({
      routeNumber,
      shipmentIds: input.shipmentIds,
      items: input.items,
      stops: input.stops,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      ...(input.serviceDate != null && input.slot != null
        ? { serviceDate: input.serviceDate, slot: input.slot }
        : {}),
      appointment: input.appointment,
      driverName: ROUTE_DRIVER_NAME,
      vehiclePlate: ROUTE_VEHICLE_PLATE,
      createdBy: ROUTE_CREATED_BY,
    });
  }

  private async snapshotsFor(child: RoutedChild): Promise<RouteItem[]> {
    const items = await this.itemsService.findByIds(child.itemIds);
    const byId = new Map(items.map((item) => [item.id, item]));
    return child.itemIds.map((itemId) => {
      const item = byId.get(itemId);
      if (!item || item.weight == null || !item.weightUnit) {
        throw new Error(
          `Item ${itemId} cannot be copied onto a route for shipment ${child.id}`,
        );
      }
      return snapshotOf(item, child.id);
    });
  }
}

function endsOf(child: RoutedChild): [DeliveryInfo, DeliveryInfo] {
  const points = [...child.deliveryInfos].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (points.length !== 2) {
    throw new Error(`Shipment ${child.id} does not have two ends`);
  }
  return [points[0], points[1]];
}

function stopFrom(point: DeliveryInfo, shipmentId: string): RouteStop {
  return {
    sequence: point.sequence,
    locationId: point.locationId,
    type: point.type,
    shipmentIds: [shipmentId],
    appointment: {
      from: point.appointment.from,
      to: point.appointment.to,
    },
    actualWindow: { from: null, to: null },
    status: DeliveryPointStatus.PENDING,
  };
}

function transitStop(
  sequence: number,
  locationId: string,
  shipmentId: string,
): RouteStop {
  return {
    sequence,
    locationId,
    type: DeliveryPointType.TRANSIT,
    shipmentIds: [shipmentId],
    appointment: { from: null, to: null },
    actualWindow: { from: null, to: null },
    status: DeliveryPointStatus.PENDING,
  };
}

function snapshotOf(item: Item, shipmentId: string): RouteItem {
  const snapshot: RouteItem = {
    itemId: item.id,
    shipmentId,
    itemCode: item.itemCode,
    barcode: item.barcode,
    itemUnit: item.itemUnit,
    weight: item.weight!,
    weightUnit: item.weightUnit!,
  };
  if (item.description) {
    snapshot.description = item.description;
  }
  return snapshot;
}

function assertStopsInsideRoute(route: {
  shipmentIds: string[];
  stops: { shipmentIds: string[] }[];
}): void {
  const carried = new Set(route.shipmentIds);
  const outside = route.stops.some((stop) =>
    stop.shipmentIds.some((id) => !carried.has(id)),
  );
  if (outside) {
    throw new Error('A stop lists a shipment that is not on the route');
  }
}
