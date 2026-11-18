import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { TimeWindow } from '../../common/schemas/time-window.schema';
import { ItemStatus } from '../items/enums/item-status.enum';
import { Item } from '../items/schemas/item.schema';
import { RouteStatus } from '../routes/enums/route-status.enum';
import { RouteItem } from '../routes/schemas/route-item.schema';
import { RouteStop } from '../routes/schemas/route-stop.schema';
import { Route, RouteDocument } from '../routes/schemas/route.schema';
import { ShipmentStatus } from '../shipments/enums/shipment-status.enum';
import { DeliveryInfo } from '../shipments/schemas/delivery-info.schema';
import {
  Shipment,
  ShipmentDocument,
} from '../shipments/schemas/shipment.schema';
import { DockEventFields } from './dock-event.message';
import { MISSING_ERROR_CODE } from './dock-events.constants';
import { DockTaskStatus } from './enums/dock-task-status.enum';
import { DockTaskType } from './enums/dock-task-type.enum';
import { routeEnds } from './route-ends';
import { DockTask } from './schemas/dock-task.schema';

/** A route stop or a shipment delivery point. */
type Point = { status: DeliveryPointStatus; actualWindow: TimeWindow };

/** What the rollup of one route knows after loading its tasks and items. */
interface RouteFacts {
  origin: RouteStop;
  destination: RouteStop;
  items: Map<string, Item>;
  /** `itemId:legId` of the items with a COMPLETED scan-out (or pickup) at the origin. */
  left: Set<string>;
  /** `itemId:legId` of the items with a COMPLETED scan-in (or delivery) at the destination. */
  arrived: Set<string>;
  /** A stop that only saw a "missing" mark has still been worked on (§4.4). */
  missingAtOrigin: boolean;
  missingAtDestination: boolean;
}

// Statuses only move to a higher rank. CANCELLED and SKIPPED are never overwritten.
const POINT_RANK: Record<DeliveryPointStatus, number> = {
  [DeliveryPointStatus.PENDING]: 0,
  [DeliveryPointStatus.ARRIVED]: 1,
  [DeliveryPointStatus.PROCESSING]: 2,
  [DeliveryPointStatus.COMPLETED]: 3,
  [DeliveryPointStatus.SKIPPED]: 4,
};
const ROUTE_RANK: Record<RouteStatus, number> = {
  [RouteStatus.PLANNED]: 0,
  [RouteStatus.IN_PROGRESS]: 1,
  [RouteStatus.COMPLETED]: 2,
  [RouteStatus.CANCELLED]: 3,
};
const LEG_RANK: Record<ShipmentStatus, number> = {
  [ShipmentStatus.CREATED]: 0,
  [ShipmentStatus.IN_TRANSIT]: 1,
  [ShipmentStatus.AT_DOCK]: 2,
  [ShipmentStatus.DELIVERED]: 3,
  [ShipmentStatus.EXCEPTION]: 4,
  [ShipmentStatus.CANCELLED]: 5,
};

/**
 * The operational rollup of docs/scanning-flows.md §3–§6. It recomputes a route, its
 * legs and their roots from the stored COMPLETED tasks and the current items, so a
 * second run writes the same values. It never creates a task and never publishes.
 */
@Injectable()
export class StatusRollupService {
  constructor(
    @InjectModel(DockTask.name)
    private readonly dockTaskModel: Model<DockTask>,
    @InjectModel(Item.name)
    private readonly itemModel: Model<Item>,
    @InjectModel(Route.name)
    private readonly routeModel: Model<Route>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
  ) {}

  /**
   * Updates, in this order: the route's two stops, the route and its `actualWindow`,
   * each leg of the route with its two `deliveryInfos`, then each leg's root with the
   * root points of this hop.
   */
  async apply(event: DockEventFields): Promise<void> {
    const route = await this.routeModel.findOne({
      id: event.routeId,
      deletedAt: null,
    });
    if (!route) {
      throw new Error(`Route ${event.routeId} of a dock event was not found`);
    }
    await this.checkEventFacts(event, route);
    const facts = await this.loadFacts(route);
    const now = new Date();

    this.rollUpStopsAndRoute(route, facts, now);
    await route.save();

    const legs = await this.shipmentModel.find({
      id: { $in: route.shipmentIds },
      deletedAt: null,
    });
    for (const leg of legs) {
      this.rollUpLeg(leg, route, facts, now);
      await leg.save();
    }

    const rootIds = new Set(legs.map((leg) => leg.parentId));
    for (const rootId of rootIds) {
      if (rootId) {
        await this.rollUpRoot(rootId, legs, facts, now);
      }
    }
  }

  /** The tasks and items named by the message must exist on this route. */
  private async checkEventFacts(
    event: DockEventFields,
    route: Route,
  ): Promise<void> {
    const taskIds = [...new Set(event.taskIds)];
    const found = await this.dockTaskModel.countDocuments({
      id: { $in: taskIds },
      routeId: route.id,
      deletedAt: null,
    });
    if (found !== taskIds.length) {
      throw new Error(`Some tasks of the event are not on route ${route.id}`);
    }
    const onRoute = new Set(route.items.map((row) => row.itemId));
    if (!event.itemIds.every((itemId) => onRoute.has(itemId))) {
      throw new Error(`Some items of the event are not on route ${route.id}`);
    }
  }

  private async loadFacts(route: Route): Promise<RouteFacts> {
    const { origin, destination } = routeEnds(route);
    const [tasks, items] = await Promise.all([
      this.dockTaskModel
        .find({
          routeId: route.id,
          status: DockTaskStatus.COMPLETED,
          deletedAt: null,
        })
        .lean<DockTask[]>(),
      this.itemModel
        .find({
          id: { $in: route.items.map((row) => row.itemId) },
          deletedAt: null,
        })
        .lean<Item[]>(),
    ]);
    const handled = (type: DockTaskType, stop: RouteStop) =>
      new Set(
        tasks
          .filter(
            (task) => task.type === type && task.locationId === stop.locationId,
          )
          .map((task) => rowKey(task.itemId, task.shipmentId)),
      );
    const missingAt = (stop: RouteStop) =>
      tasks.some(
        (task) =>
          task.type === DockTaskType.EXCEPTION &&
          task.errorCode === MISSING_ERROR_CODE &&
          task.locationId === stop.locationId,
      );
    return {
      origin,
      destination,
      items: new Map(items.map((item) => [item.id, item])),
      left: handled(DockTaskType.SCAN_OUTBOUND, origin),
      arrived: handled(DockTaskType.SCAN_INBOUND, destination),
      missingAtOrigin: missingAt(origin),
      missingAtDestination: missingAt(destination),
    };
  }

  /**
   * §4 stop tables: a stop is PENDING until an item is handled (or marked missing)
   * there, COMPLETED when every expected item is handled, PROCESSING in between.
   * The route leaves PLANNED with the first item that moves, and is COMPLETED with
   * its destination stop.
   */
  private rollUpStopsAndRoute(
    route: RouteDocument,
    facts: RouteFacts,
    now: Date,
  ): void {
    const expected = route.items.filter(
      (row) => facts.items.get(row.itemId)?.status !== ItemStatus.EXCEPTION,
    );
    raisePoint(
      facts.origin,
      stopStatus(expected, facts.left, facts.missingAtOrigin),
      now,
    );
    raisePoint(
      facts.destination,
      stopStatus(expected, facts.arrived, facts.missingAtDestination),
      now,
    );

    let target: RouteStatus | null = null;
    if (facts.destination.status === DeliveryPointStatus.COMPLETED) {
      target = RouteStatus.COMPLETED;
    } else if (facts.left.size > 0 || facts.arrived.size > 0) {
      target = RouteStatus.IN_PROGRESS;
    }
    if (target && ROUTE_RANK[target] > ROUTE_RANK[route.status]) {
      route.status = target;
      route.actualWindow.from ??= now;
      if (target === RouteStatus.COMPLETED) {
        route.actualWindow.to ??= now;
      }
    }
  }

  /**
   * §6 leg table, from the leg's own items. An item counts as "at the destination"
   * once it has a COMPLETED scan-in there for this leg, even if it has moved on since.
   * The leg's origin point follows the origin stop once one of its items has left;
   * its destination point is COMPLETED once all its non-exception items arrived.
   */
  private rollUpLeg(
    leg: ShipmentDocument,
    route: Route,
    facts: RouteFacts,
    now: Date,
  ): void {
    // Mongoose types a hydrated document's `id` as `any`; the schema's is a string.
    const legId = (leg as Shipment).id;
    const rows = route.items.filter((row) => row.shipmentId === legId);
    const items = rows
      .map((row) => facts.items.get(row.itemId))
      .filter((item): item is Item => item !== undefined);
    const active = items.filter((item) => item.status !== ItemStatus.EXCEPTION);
    const allArrived =
      active.length > 0 &&
      active.every((item) => facts.arrived.has(rowKey(item.id, legId)));
    const [legOrigin, legDestination] = pointsInOrder(leg);

    let target: ShipmentStatus = ShipmentStatus.CREATED;
    if (items.length > 0 && active.length === 0) {
      target = ShipmentStatus.EXCEPTION;
    } else if (allArrived) {
      target =
        legDestination.type === DeliveryPointType.DROPOFF
          ? ShipmentStatus.DELIVERED
          : ShipmentStatus.AT_DOCK;
    } else if (
      active.some(
        (item) =>
          item.status === ItemStatus.IN_TRANSIT &&
          item.currentShipmentId === legId,
      )
    ) {
      target = ShipmentStatus.IN_TRANSIT;
    }
    if (LEG_RANK[target] > LEG_RANK[leg.status]) {
      leg.status = target;
    }

    if (rows.some((row) => facts.left.has(rowKey(row.itemId, legId)))) {
      raisePoint(
        legOrigin,
        facts.origin.status,
        now,
        facts.origin.actualWindow,
      );
    }
    if (allArrived) {
      raisePoint(
        legDestination,
        DeliveryPointStatus.COMPLETED,
        now,
        facts.destination.actualWindow,
      );
    }
  }

  /**
   * §6 root table over all its items and legs. The root's points of this hop follow
   * the route's stops once an item of the booking has left or arrived there.
   */
  private async rollUpRoot(
    rootId: string,
    routeLegs: ShipmentDocument[],
    facts: RouteFacts,
    now: Date,
  ): Promise<void> {
    const root = await this.shipmentModel.findOne({
      id: rootId,
      deletedAt: null,
    });
    if (!root) {
      throw new Error(`Root shipment ${rootId} was not found`);
    }
    const [children, items] = await Promise.all([
      this.shipmentModel
        .find({ id: { $in: root.childrenIds }, deletedAt: null })
        .lean<Shipment[]>(),
      this.itemModel
        .find({ id: { $in: root.itemIds }, deletedAt: null })
        .lean<Item[]>(),
    ]);
    const legStatus = new Map(
      [...children, ...routeLegs].map((leg) => [leg.id, leg.status]),
    );
    const statuses = root.childrenIds.map((id) => legStatus.get(id));
    const lastLeg = root.childrenIds[root.childrenIds.length - 1];

    let target: ShipmentStatus = ShipmentStatus.CREATED;
    if (items.some((item) => item.status === ItemStatus.EXCEPTION)) {
      target = ShipmentStatus.EXCEPTION;
    } else if (legStatus.get(lastLeg) === ShipmentStatus.DELIVERED) {
      target = ShipmentStatus.DELIVERED;
    } else if (statuses.includes(ShipmentStatus.IN_TRANSIT)) {
      target = ShipmentStatus.IN_TRANSIT;
    } else if (statuses.includes(ShipmentStatus.AT_DOCK)) {
      target = ShipmentStatus.AT_DOCK;
    }
    root.status = nextRootStatus(root.status, target);

    for (const leg of routeLegs.filter((leg) => leg.parentId === root.id)) {
      const legId = (leg as Shipment).id;
      const hasItem = (keys: Set<string>) =>
        leg.itemIds.some((itemId) => keys.has(rowKey(itemId, legId)));
      const rootPoint = (stop: RouteStop) =>
        root.deliveryInfos.find(
          (point) => point.locationId === stop.locationId,
        );
      const originPoint = rootPoint(facts.origin);
      if (originPoint && hasItem(facts.left)) {
        raisePoint(
          originPoint,
          facts.origin.status,
          now,
          facts.origin.actualWindow,
        );
      }
      const destinationPoint = rootPoint(facts.destination);
      if (destinationPoint && hasItem(facts.arrived)) {
        raisePoint(
          destinationPoint,
          facts.destination.status,
          now,
          facts.destination.actualWindow,
        );
      }
    }
    await root.save();
  }
}

function rowKey(itemId: string, legId: string): string {
  return `${itemId}:${legId}`;
}

function stopStatus(
  expected: RouteItem[],
  handled: Set<string>,
  missingHere: boolean,
): DeliveryPointStatus {
  if (handled.size === 0 && !missingHere) {
    return DeliveryPointStatus.PENDING;
  }
  return expected.every((row) =>
    handled.has(rowKey(row.itemId, row.shipmentId)),
  )
    ? DeliveryPointStatus.COMPLETED
    : DeliveryPointStatus.PROCESSING;
}

/**
 * Moves a point forward. `actualWindow.from` is set the first time it leaves PENDING
 * and `actualWindow.to` when it is COMPLETED, copied from `source` (the route stop)
 * when that is known, otherwise now.
 */
function raisePoint(
  point: Point,
  target: DeliveryPointStatus,
  now: Date,
  source?: TimeWindow,
): void {
  if (POINT_RANK[target] <= POINT_RANK[point.status]) {
    return;
  }
  point.status = target;
  const from = point.actualWindow.from ?? source?.from ?? now;
  point.actualWindow.from = from;
  if (target === DeliveryPointStatus.COMPLETED && !point.actualWindow.to) {
    const to = source?.to ?? now;
    point.actualWindow.to = to < from ? from : to;
  }
}

/**
 * The root's IN_TRANSIT and AT_DOCK alternate hop by hop along the path. It never
 * returns to CREATED and never leaves EXCEPTION, DELIVERED or CANCELLED.
 */
function nextRootStatus(
  current: ShipmentStatus,
  computed: ShipmentStatus,
): ShipmentStatus {
  const final = [
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
  ];
  if (final.includes(current) || computed === ShipmentStatus.CREATED) {
    return current;
  }
  return computed;
}

function pointsInOrder(leg: Shipment): [DeliveryInfo, DeliveryInfo] {
  const points = [...leg.deliveryInfos].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (points.length !== 2) {
    throw new Error(`Leg ${leg.id} does not have two delivery points`);
  }
  return [points[0], points[1]];
}
