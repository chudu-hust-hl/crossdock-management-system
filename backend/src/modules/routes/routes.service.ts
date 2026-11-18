import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { BusinessCodeType } from '../../common/enums/business-code-type.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { buildSort, findPage } from '../../common/utils/pagination.util';
import { containsIgnoringCase } from '../../common/utils/text-filter.util';
import { DockTask } from '../dock-tasks/schemas/dock-task.schema';
import { ItemsService } from '../items/items.service';
import { Item } from '../items/schemas/item.schema';
import { LocationType } from '../locations/enums/location-type.enum';
import { LocationsService } from '../locations/locations.service';
import { MetadataService } from '../metadata/metadata.service';
import { ShipmentStatus } from '../shipments/enums/shipment-status.enum';
import { DeliveryInfo } from '../shipments/schemas/delivery-info.schema';
import { Shipment } from '../shipments/schemas/shipment.schema';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { RouteCandidateResponse } from './dto/route-candidate-response.dto';
import {
  RoutePageResponse,
  toRoutePageResponse,
} from './dto/route-summary-response.dto';
import {
  RouteShipmentResponse,
  RouteStopLocation,
  RouteViewResponse,
  toRouteViewResponse,
} from './dto/route-view-response.dto';
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
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
    @InjectModel(DockTask.name)
    private readonly dockTaskModel: Model<DockTask>,
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

  /**
   * Non-deleted routes, one page. Locations of the page are loaded with one query.
   * Sort is `appointment.from` ascending, then `id`.
   */
  async findPage(query: ListRoutesQueryDto): Promise<RoutePageResponse> {
    const page = await findPage(
      this.routeModel,
      this.buildListFilter(query),
      buildSort('appointment.from', SortOrder.ASC),
      query,
    );
    const locationIds = [
      ...new Set(
        page.items.flatMap((route) => [
          route.fromLocationId,
          route.toLocationId,
        ]),
      ),
    ];
    const locations =
      await this.locationsService.findSummariesByIds(locationIds);
    return toRoutePageResponse(page, locations);
  }

  /** One route, its two stop locations, and the shipments on it. */
  async findView(id: string): Promise<RouteViewResponse> {
    const route = await this.requireRoute(id);
    return this.viewOf(route.toObject());
  }

  /**
   * CREATED children whose two ends are this route's stops, in that order,
   * and that are not already listed on it.
   */
  async findCandidates(id: string): Promise<RouteCandidateResponse[]> {
    const route = await this.requireRoute(id);
    const children = await this.shipmentModel
      .find({
        status: ShipmentStatus.CREATED,
        deletedAt: null,
        parentId: { $type: 'string' },
        id: { $nin: route.shipmentIds },
        deliveryInfos: {
          $size: 2,
          $all: [
            {
              $elemMatch: {
                sequence: 1,
                locationId: route.fromLocationId,
              },
            },
            {
              $elemMatch: {
                sequence: 2,
                locationId: route.toLocationId,
              },
            },
          ],
        },
      })
      .sort({ code: 1, id: 1 })
      .lean<Shipment[]>()
      .exec();
    const parents = await this.rootsOf(children);
    return children.map((child) => {
      const parent = child.parentId ? parents.get(child.parentId) : undefined;
      return {
        id: child.id,
        code: child.code,
        parentCode: parent?.code ?? null,
        customerName: parent?.customerName ?? null,
        itemCount: child.itemIds.length,
      };
    });
  }

  /**
   * Moves CREATED children onto this PLANNED route. Nothing is written when any
   * id is rejected (docs/domain-model.md §4.5).
   */
  async addShipments(
    routeId: string,
    shipmentIds: string[],
  ): Promise<RouteViewResponse> {
    const route = await this.requireRoute(routeId);
    if (route.status !== RouteStatus.PLANNED) {
      throw new ConflictException(
        `Route ${route.routeNumber} is ${route.status}, not PLANNED`,
      );
    }

    const found = await this.shipmentModel
      .find({ id: { $in: shipmentIds }, deletedAt: null })
      .lean<Shipment[]>()
      .exec();
    const byId = new Map(found.map((shipment) => [shipment.id, shipment]));
    const accepted: Shipment[] = [];
    for (const id of shipmentIds) {
      const shipment = byId.get(id);
      if (!shipment || !hasRouteEnds(shipment, route)) {
        throw new ConflictException(
          `Shipment ${id} is not a CREATED child from ${route.fromLocationId} to ${route.toLocationId}`,
        );
      }
      accepted.push(shipment);
    }
    for (const id of shipmentIds) {
      if (route.shipmentIds.includes(id)) {
        throw new ConflictException(
          `Shipment ${id} is already on route ${route.routeNumber}`,
        );
      }
    }
    const tasked = await this.dockTaskModel
      .findOne({ shipmentId: { $in: shipmentIds }, deletedAt: null })
      .lean<DockTask>()
      .exec();
    if (tasked) {
      throw new ConflictException(
        `Shipment ${tasked.shipmentId} already has a dock task`,
      );
    }

    const snapshots = await this.snapshotsForShipments(accepted);
    await this.detachFromOtherRoutes(shipmentIds, routeId);
    this.appendShipments(route, shipmentIds, snapshots);
    await route.save();
    return this.viewOf(route.toObject());
  }

  private buildListFilter(query: ListRoutesQueryDto): FilterQuery<Route> {
    return {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.routeNumber && {
        routeNumber: containsIgnoringCase(query.routeNumber),
      }),
      ...(query.serviceDate && { serviceDate: query.serviceDate }),
      ...(query.slot && { slot: query.slot }),
    };
  }

  private async requireRoute(id: string): Promise<RouteDocument> {
    const route = await this.routeModel.findOne({ id, deletedAt: null });
    if (!route) {
      throw new NotFoundException(`Route ${id} not found`);
    }
    return route;
  }

  private async viewOf(route: Route): Promise<RouteViewResponse> {
    const [locations, shipments] = await Promise.all([
      this.stopLocations(route),
      this.shipmentsOn(route),
    ]);
    return toRouteViewResponse({ route, locations, shipments });
  }

  /** The two stop locations, in stop order. A missing Location is omitted. */
  private async stopLocations(route: Route): Promise<RouteStopLocation[]> {
    const stopIds = [...route.stops]
      .sort((left, right) => left.sequence - right.sequence)
      .map((stop) => stop.locationId);
    const found = await this.locationsService.findByIds(stopIds);
    const byId = new Map(found.map((location) => [location.id, location]));
    return stopIds.flatMap((id) => {
      const location = byId.get(id);
      return location
        ? [
            {
              id: location.id,
              name: location.name,
              type: location.type,
              address: location.address,
            },
          ]
        : [];
    });
  }

  /**
   * Shipments of `route.shipmentIds`, in that order. One query for those
   * shipments and one for their roots. A missing shipment is omitted.
   */
  private async shipmentsOn(route: Route): Promise<RouteShipmentResponse[]> {
    if (route.shipmentIds.length === 0) {
      return [];
    }
    const found = await this.shipmentModel
      .find({ id: { $in: route.shipmentIds }, deletedAt: null })
      .lean<Shipment[]>()
      .exec();
    const byId = new Map(found.map((shipment) => [shipment.id, shipment]));
    const ordered = route.shipmentIds.flatMap((id) => {
      const shipment = byId.get(id);
      return shipment ? [shipment] : [];
    });
    const parents = await this.rootsOf(ordered);
    return ordered.map((shipment) => ({
      id: shipment.id,
      code: shipment.code,
      status: shipment.status,
      parentId: shipment.parentId,
      customerName: shipment.parentId
        ? (parents.get(shipment.parentId)?.customerName ?? null)
        : null,
      itemCount: shipment.itemIds.length,
    }));
  }

  /** One query for the roots of these children. */
  private async rootsOf(children: Shipment[]): Promise<Map<string, Shipment>> {
    const parentIds = [
      ...new Set(
        children.flatMap((child) => (child.parentId ? [child.parentId] : [])),
      ),
    ];
    if (parentIds.length === 0) {
      return new Map();
    }
    const parents = await this.shipmentModel
      .find({ id: { $in: parentIds }, deletedAt: null })
      .lean<Shipment[]>()
      .exec();
    return new Map(parents.map((parent) => [parent.id, parent]));
  }

  /**
   * Removes these children from every other non-deleted route: the route list,
   * both stops, and the snapshots. An emptied route is soft-deleted so the
   * dock-lane index no longer holds it.
   */
  private async detachFromOtherRoutes(
    shipmentIds: string[],
    stayingOnRouteId: string,
  ): Promise<void> {
    const moving = new Set(shipmentIds);
    const sources = await this.routeModel.find({
      id: { $ne: stayingOnRouteId },
      shipmentIds: { $in: shipmentIds },
      deletedAt: null,
    });
    for (const source of sources) {
      source.shipmentIds = source.shipmentIds.filter((id) => !moving.has(id));
      for (const stop of source.stops) {
        stop.shipmentIds = stop.shipmentIds.filter((id) => !moving.has(id));
      }
      source.items = source.items.filter(
        (item) => !moving.has(item.shipmentId),
      );
      if (source.shipmentIds.length === 0) {
        source.deletedAt = new Date();
      }
      assertStopsInsideRoute(source);
      source.markModified('shipmentIds');
      source.markModified('stops');
      source.markModified('items');
      await source.save();
    }
  }

  private appendShipments(
    route: RouteDocument,
    shipmentIds: string[],
    snapshots: RouteItem[],
  ): void {
    for (const shipmentId of shipmentIds) {
      if (!route.shipmentIds.includes(shipmentId)) {
        route.shipmentIds.push(shipmentId);
      }
      for (const stop of route.stops) {
        if (!stop.shipmentIds.includes(shipmentId)) {
          stop.shipmentIds.push(shipmentId);
        }
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
  }

  /** Copies every item of these children. One item query for the whole request. */
  private async snapshotsForShipments(
    shipments: Shipment[],
  ): Promise<RouteItem[]> {
    const itemIds = [
      ...new Set(shipments.flatMap((shipment) => shipment.itemIds)),
    ];
    const items = await this.itemsService.findByIds(itemIds);
    const byId = new Map(items.map((item) => [item.id, item]));
    const snapshots: RouteItem[] = [];
    for (const shipment of shipments) {
      for (const itemId of shipment.itemIds) {
        const item = byId.get(itemId);
        if (!item || item.weight == null || !item.weightUnit) {
          throw new Error(
            `Item ${itemId} cannot be copied onto a route for shipment ${shipment.id}`,
          );
        }
        snapshots.push(snapshotOf(item, shipment.id));
      }
    }
    return snapshots;
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

/** A CREATED child whose delivery infos are this route's two ends, in order. */
function hasRouteEnds(
  shipment: Shipment,
  route: Pick<Route, 'fromLocationId' | 'toLocationId'>,
): boolean {
  if (shipment.parentId == null || shipment.status !== ShipmentStatus.CREATED) {
    return false;
  }
  const points = [...shipment.deliveryInfos].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return (
    points.length === 2 &&
    points[0].locationId === route.fromLocationId &&
    points[1].locationId === route.toLocationId
  );
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
