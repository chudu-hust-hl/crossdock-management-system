import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { generateUlid } from '../../common/utils/ulid.util';
import { ItemStatus } from '../items/enums/item-status.enum';
import { Item } from '../items/schemas/item.schema';
import { RouteStatus } from '../routes/enums/route-status.enum';
import { Route } from '../routes/schemas/route.schema';
import { ShipmentStatus } from '../shipments/enums/shipment-status.enum';
import { Shipment } from '../shipments/schemas/shipment.schema';
import { DockEvent, DockEventFields } from './dock-event.message';
import {
  EVENTS_EXCHANGE,
  MISSING_ERROR_CODE,
  ROUTING_KEY_OF,
} from './dock-events.constants';
import { DockEventType } from './enums/dock-event-type.enum';
import { DockTaskStatus } from './enums/dock-task-status.enum';
import { DockTaskType } from './enums/dock-task-type.enum';
import { RabbitMqService } from './rabbitmq.service';
import { routeEnds } from './route-ends';
import { DockTask } from './schemas/dock-task.schema';

/** Sends dock events to `crossdock.events`, and sends again the ones the rollup missed. */
@Injectable()
export class DockEventsPublisher {
  constructor(
    private readonly rabbitMq: RabbitMqService,
    @InjectModel(DockTask.name)
    private readonly dockTaskModel: Model<DockTask>,
    @InjectModel(Item.name)
    private readonly itemModel: Model<Item>,
    @InjectModel(Route.name)
    private readonly routeModel: Model<Route>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
  ) {}

  /** `503` naming RABBITMQ_URL when a dock action could not publish. */
  assertAvailable(): void {
    this.rabbitMq.assertConnected();
  }

  /** One message with the routing key of its type (docs/scanning-flows.md §8). */
  async publish(fields: DockEventFields): Promise<void> {
    const event: DockEvent = {
      eventId: generateUlid(),
      occurredAt: new Date().toISOString(),
      ...fields,
    };
    await this.rabbitMq.publish(
      EVENTS_EXCHANGE,
      ROUTING_KEY_OF[event.type],
      Buffer.from(JSON.stringify(event)),
    );
  }

  /**
   * Publishes again, one message per item, the facts whose rollup has not run
   * (docs/scanning-flows.md §8, "Replay"). Returns how many messages were sent.
   */
  async republishPendingRollups(): Promise<number> {
    const tasks = [
      ...(await this.pickedUpOrScannedOutOnPlannedRoutes()),
      ...(await this.scannedInAtPendingStops()),
      ...(await this.deliveredOnOpenRoutes()),
      ...(await this.missingUnderOpenRoots()),
    ];
    for (const task of tasks) {
      await this.publish(eventOf(task));
    }
    return tasks.length;
  }

  /** An item `IN_TRANSIT` on a leg whose route is still `PLANNED`. */
  private async pickedUpOrScannedOutOnPlannedRoutes(): Promise<DockTask[]> {
    const found: DockTask[] = [];
    for (const item of await this.itemsWith(ItemStatus.IN_TRANSIT)) {
      const route = await this.routeModel
        .findOne({
          shipmentIds: item.currentShipmentId,
          status: RouteStatus.PLANNED,
          deletedAt: null,
        })
        .lean<Route>();
      const task =
        route &&
        (await this.lastCompleted({
          itemId: item.id,
          routeId: route.id,
          type: DockTaskType.SCAN_OUTBOUND,
        }));
      if (task) {
        found.push(task);
      }
    }
    return found;
  }

  /** An item `AT_DOCK` at a route's destination while that stop is still `PENDING`. */
  private async scannedInAtPendingStops(): Promise<DockTask[]> {
    const found: DockTask[] = [];
    for (const item of await this.itemsWith(ItemStatus.AT_DOCK)) {
      const task = await this.lastCompleted({
        itemId: item.id,
        locationId: item.currentLocationId,
        type: DockTaskType.SCAN_INBOUND,
      });
      const route =
        task &&
        (await this.routeModel
          .findOne({ id: task.routeId, deletedAt: null })
          .lean<Route>());
      if (
        route &&
        routeEnds(route).destination.status === DeliveryPointStatus.PENDING
      ) {
        found.push(task);
      }
    }
    return found;
  }

  /** An item `DELIVERED` while its dock–store route is not `COMPLETED`. */
  private async deliveredOnOpenRoutes(): Promise<DockTask[]> {
    const found: DockTask[] = [];
    for (const item of await this.itemsWith(ItemStatus.DELIVERED)) {
      const task = await this.lastCompleted({
        itemId: item.id,
        type: DockTaskType.SCAN_INBOUND,
        'metadata.reason': DockEventType.MANUAL_DELIVERY,
      });
      const open =
        task &&
        (await this.routeModel.exists({
          id: task.routeId,
          status: { $ne: RouteStatus.COMPLETED },
          deletedAt: null,
        }));
      if (open) {
        found.push(task);
      }
    }
    return found;
  }

  /** An item `EXCEPTION` with a `MISSING` task while its root is not `EXCEPTION`. */
  private async missingUnderOpenRoots(): Promise<DockTask[]> {
    const found: DockTask[] = [];
    for (const item of await this.itemsWith(ItemStatus.EXCEPTION)) {
      const task = await this.lastCompleted({
        itemId: item.id,
        type: DockTaskType.EXCEPTION,
        errorCode: MISSING_ERROR_CODE,
      });
      const shipment =
        task &&
        (await this.shipmentModel
          .findOne({ id: item.currentShipmentId, deletedAt: null })
          .lean<Shipment>());
      const open =
        shipment &&
        (await this.shipmentModel.exists({
          id: shipment.parentId ?? shipment.id,
          status: { $ne: ShipmentStatus.EXCEPTION },
          deletedAt: null,
        }));
      if (open) {
        found.push(task);
      }
    }
    return found;
  }

  private itemsWith(status: ItemStatus): Promise<Item[]> {
    return this.itemModel.find({ status, deletedAt: null }).lean<Item[]>();
  }

  private lastCompleted(
    filter: Record<string, unknown>,
  ): Promise<DockTask | null> {
    return this.dockTaskModel
      .findOne({ ...filter, status: DockTaskStatus.COMPLETED, deletedAt: null })
      .sort({ completedAt: -1 })
      .lean<DockTask>();
  }
}

/** The message a completed task was published with. */
function eventOf(task: DockTask): DockEventFields {
  const reason = task.metadata?.reason;
  let type: DockEventType;
  if (task.type === DockTaskType.EXCEPTION) {
    type = DockEventType.MISSING;
  } else if (task.type === DockTaskType.SCAN_OUTBOUND) {
    type =
      reason === DockEventType.MANUAL_PICKUP
        ? DockEventType.MANUAL_PICKUP
        : DockEventType.SCAN_OUTBOUND;
  } else {
    type =
      reason === DockEventType.MANUAL_DELIVERY
        ? DockEventType.MANUAL_DELIVERY
        : DockEventType.SCAN_INBOUND;
  }
  return {
    type,
    routeId: task.routeId,
    locationId: task.locationId,
    itemIds: [task.itemId],
    taskIds: [task.id],
  };
}
