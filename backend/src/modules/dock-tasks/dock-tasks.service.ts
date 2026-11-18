import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { mkdir, rm, writeFile } from 'fs/promises';
import { Model } from 'mongoose';
import { join } from 'path';
import { BusinessCodeType } from '../../common/enums/business-code-type.enum';
import { AppConfig } from '../../config/configuration';
import { ItemStatus } from '../items/enums/item-status.enum';
import { Item } from '../items/schemas/item.schema';
import { LocationType } from '../locations/enums/location-type.enum';
import { LocationsService } from '../locations/locations.service';
import { MetadataService } from '../metadata/metadata.service';
import { RouteStatus } from '../routes/enums/route-status.enum';
import { Route } from '../routes/schemas/route.schema';
import { Shipment } from '../shipments/schemas/shipment.schema';
import { AuthenticatedUser } from '../users/users.service';
import { MISSING_ERROR_CODE } from './dock-events.constants';
import { DockEventsPublisher } from './dock-events.publisher';
import { ListDockTasksQueryDto } from './dto/list-dock-tasks-query.dto';
import { MarkMissingDto } from './dto/mark-missing.dto';
import { RouteActionDto } from './dto/route-action.dto';
import { ScanDto, UploadedPhoto } from './dto/scan.dto';
import { DockEventType } from './enums/dock-event-type.enum';
import { DockTaskStatus } from './enums/dock-task-status.enum';
import { DockTaskType } from './enums/dock-task-type.enum';
import { routeEnds } from './route-ends';
import { DockTask } from './schemas/dock-task.schema';

/** The tasks a dock action completed and the next PENDING tasks it created. */
export interface DockActionResult {
  completed: DockTask[];
  pending: DockTask[];
}

/** A task of the dock screen, with the item as the route snapshot shows it. */
export interface DockTaskRow {
  task: DockTask;
  itemCode: string | null;
  barcode: string | null;
}

/** The fields of a task that a dock action decides; the rest has schema defaults. */
type NewTask = Pick<
  DockTask,
  | 'type'
  | 'itemId'
  | 'shipmentId'
  | 'routeId'
  | 'locationId'
  | 'inboundLegId'
  | 'outboundLegId'
> &
  Partial<
    Pick<
      DockTask,
      | 'status'
      | 'performedBy'
      | 'completedAt'
      | 'metadata'
      | 'errorCode'
      | 'errorMessage'
    >
  >;

/** Accepted photo types: the file extension and the first bytes of such a file. */
const PHOTO_TYPES: Record<string, { extension: string; signature: number[] }> =
  {
    'image/jpeg': { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
    'image/png': { extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47] },
  };

const SCAN_TYPES = [DockTaskType.SCAN_INBOUND, DockTaskType.SCAN_OUTBOUND];

/**
 * The four dock actions of docs/scanning-flows.md §4. Each request stores the
 * physical fact (COMPLETED tasks, items, the next PENDING task, §5), then publishes
 * one message. It never updates a route stop, a route, a leg or a root: that is
 * `StatusRollupService`, run by the consumer.
 */
@Injectable()
export class DockTasksService {
  private readonly logger = new Logger(DockTasksService.name);
  private readonly podDir: string;

  constructor(
    @InjectModel(DockTask.name)
    private readonly dockTaskModel: Model<DockTask>,
    @InjectModel(Item.name)
    private readonly itemModel: Model<Item>,
    @InjectModel(Route.name)
    private readonly routeModel: Model<Route>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
    private readonly locationsService: LocationsService,
    private readonly metadataService: MetadataService,
    private readonly publisher: DockEventsPublisher,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.podDir = configService.get('podDir', { infer: true });
  }

  /** §4.1: the truck has taken every expected item of a PLANNED store–dock route. */
  async confirmPickup(
    dto: RouteActionDto,
    user: AuthenticatedUser,
  ): Promise<DockActionResult> {
    const route = await this.findRoute(dto.routeId);
    if (route.status !== RouteStatus.PLANNED) {
      throw new ConflictException(
        `Route ${route.routeNumber} is ${route.status}; only a PLANNED route can be picked up`,
      );
    }
    const { origin, destination } = routeEnds(route);
    await this.assertLocationType(
      origin.locationId,
      LocationType.STORE,
      `Route ${route.routeNumber} does not start at a store; pickup is confirmed on a store–dock route`,
    );
    const items = await this.itemsOf(route);
    // A retried pickup skips the items it already took.
    const rows = route.items.filter(
      (row) => items.get(row.itemId)?.status === ItemStatus.CREATED,
    );
    if (rows.length === 0) {
      throw new ConflictException(
        `Route ${route.routeNumber} has no item left to pick up`,
      );
    }
    this.publisher.assertAvailable();

    const now = new Date();
    const result: DockActionResult = { completed: [], pending: [] };
    for (const row of rows) {
      result.completed.push(
        await this.createTask({
          type: DockTaskType.SCAN_OUTBOUND,
          status: DockTaskStatus.COMPLETED,
          itemId: row.itemId,
          shipmentId: row.shipmentId,
          routeId: route.id,
          locationId: origin.locationId,
          inboundLegId: null,
          outboundLegId: row.shipmentId,
          performedBy: user.id,
          completedAt: now,
          metadata: { reason: DockEventType.MANUAL_PICKUP },
        }),
      );
      await this.updateItem(row.itemId, {
        status: ItemStatus.IN_TRANSIT,
        currentShipmentId: row.shipmentId,
      });
      await this.addPending(result, {
        type: DockTaskType.SCAN_INBOUND,
        itemId: row.itemId,
        shipmentId: row.shipmentId,
        routeId: route.id,
        locationId: destination.locationId,
        inboundLegId: row.shipmentId,
        outboundLegId: null,
      });
    }
    await this.publish(
      DockEventType.MANUAL_PICKUP,
      route.id,
      origin.locationId,
      result,
    );
    return result;
  }

  /** §4.2 and §4.3: a barcode matching one PENDING scan task, with its photo. */
  async scan(
    dto: ScanDto,
    photo: UploadedPhoto | undefined,
    user: AuthenticatedUser,
  ): Promise<DockActionResult> {
    const extension = photoExtension(photo);
    const notFound = new NotFoundException(
      `No PENDING scan task for barcode ${dto.barcode} at Location ${dto.locationId} on route ${dto.routeId}`,
    );
    const item = await this.itemModel
      .findOne({ barcode: dto.barcode, deletedAt: null })
      .lean<Item>();
    const task =
      item &&
      (await this.dockTaskModel
        .findOne({
          itemId: item.id,
          routeId: dto.routeId,
          locationId: dto.locationId,
          type: { $in: SCAN_TYPES },
          status: DockTaskStatus.PENDING,
          deletedAt: null,
        })
        .lean<DockTask>());
    if (!item || !task) {
      throw notFound;
    }
    if (item.status === ItemStatus.EXCEPTION) {
      throw new ConflictException(
        `Item ${item.itemCode} was marked missing and cannot be scanned`,
      );
    }
    const route = await this.findRoute(task.routeId);
    const inbound = task.type === DockTaskType.SCAN_INBOUND;
    const rootId = await this.rootIdOf(task.shipmentId);
    const next = inbound
      ? await this.nextAfterScanIn(task)
      : await this.nextAfterScanOut(task, route);
    this.publisher.assertAvailable();

    const podPath = await this.savePhoto(task.id, extension, photo!.buffer);
    const completed = await this.completePending(task.id, {
      performedBy: user.id,
      completedAt: new Date(),
      'metadata.podPath': podPath,
    });
    if (!completed) {
      // Another request completed it in the meantime.
      await rm(podPath, { force: true });
      throw notFound;
    }
    if (inbound) {
      await this.updateItem(item.id, {
        status: ItemStatus.AT_DOCK,
        currentLocationId: dto.locationId,
        currentShipmentId: rootId,
      });
    } else {
      await this.updateItem(item.id, {
        status: ItemStatus.IN_TRANSIT,
        currentShipmentId: task.outboundLegId ?? task.shipmentId,
      });
    }
    const result: DockActionResult = { completed: [completed], pending: [] };
    if (next) {
      await this.addPending(result, next);
    }
    await this.publish(
      inbound ? DockEventType.SCAN_INBOUND : DockEventType.SCAN_OUTBOUND,
      route.id,
      dto.locationId,
      result,
    );
    return result;
  }

  /** §4.4: one expected item is missing at one stop, so the others can go on. */
  async markMissing(
    dto: MarkMissingDto,
    user: AuthenticatedUser,
  ): Promise<DockActionResult> {
    const route = await this.findRoute(dto.routeId);
    if (!route.stops.some((stop) => stop.locationId === dto.locationId)) {
      throw new NotFoundException(
        `Location ${dto.locationId} is not a stop of route ${route.routeNumber}`,
      );
    }
    const row = route.items.find((entry) => entry.itemId === dto.itemId);
    const item = await this.itemModel
      .findOne({ id: dto.itemId, deletedAt: null })
      .lean<Item>();
    if (!row || !item) {
      throw new NotFoundException(
        `Item ${dto.itemId} is not on route ${route.routeNumber}`,
      );
    }
    if (
      item.status === ItemStatus.EXCEPTION ||
      item.status === ItemStatus.DELIVERED
    ) {
      throw new ConflictException(
        `Item ${item.itemCode} is ${item.status} and cannot be marked missing`,
      );
    }
    const open = await this.dockTaskModel
      .findOne({
        itemId: item.id,
        routeId: route.id,
        locationId: dto.locationId,
        type: { $in: SCAN_TYPES },
        status: DockTaskStatus.PENDING,
        deletedAt: null,
      })
      .lean<DockTask>();
    // Without an open task, the stop decides which way the item was going.
    const atDestination =
      routeEnds(route).destination.locationId === dto.locationId;
    const legIds = open
      ? { inboundLegId: open.inboundLegId, outboundLegId: open.outboundLegId }
      : {
          inboundLegId: atDestination ? row.shipmentId : null,
          outboundLegId: atDestination ? null : row.shipmentId,
        };
    this.publisher.assertAvailable();

    const now = new Date();
    const result: DockActionResult = { completed: [], pending: [] };
    const closed =
      open &&
      (await this.completePending(open.id, {
        performedBy: user.id,
        completedAt: now,
      }));
    if (closed) {
      result.completed.push(closed);
    }
    result.completed.push(
      await this.createTask({
        type: DockTaskType.EXCEPTION,
        status: DockTaskStatus.COMPLETED,
        itemId: item.id,
        shipmentId: open?.shipmentId ?? row.shipmentId,
        routeId: route.id,
        locationId: dto.locationId,
        ...legIds,
        performedBy: user.id,
        completedAt: now,
        errorCode: MISSING_ERROR_CODE,
        errorMessage: dto.note,
        metadata: { reason: DockEventType.MISSING },
      }),
    );
    await this.updateItem(item.id, { status: ItemStatus.EXCEPTION });
    await this.publish(DockEventType.MISSING, route.id, dto.locationId, result);
    return result;
  }

  /** §4.5: every expected item of a dock–store route was handed over at the store. */
  async confirmDelivery(
    dto: RouteActionDto,
    user: AuthenticatedUser,
  ): Promise<DockActionResult> {
    const route = await this.findRoute(dto.routeId);
    const { destination } = routeEnds(route);
    await this.assertLocationType(
      destination.locationId,
      LocationType.STORE,
      `Route ${route.routeNumber} does not end at a store; delivery is confirmed on a dock–store route`,
    );
    const items = await this.itemsOf(route);
    const rows = route.items.filter((row) => {
      const item = items.get(row.itemId);
      return item !== undefined && item.status !== ItemStatus.EXCEPTION;
    });
    const notReady = rows.filter((row) => {
      const item = items.get(row.itemId)!;
      return (
        item.status !== ItemStatus.IN_TRANSIT ||
        item.currentShipmentId !== row.shipmentId
      );
    });
    if (rows.length === 0 || notReady.length > 0) {
      throw new ConflictException(
        `Every expected item of route ${route.routeNumber} must be IN_TRANSIT on this leg ` +
          `(scanned out of the last dock) before delivery; not ready: ` +
          (notReady.map((row) => row.itemCode).join(', ') ||
            'no expected item'),
      );
    }
    const rootIds = new Map<string, string>();
    for (const legId of new Set(rows.map((row) => row.shipmentId))) {
      rootIds.set(legId, await this.rootIdOf(legId));
    }
    this.publisher.assertAvailable();

    const now = new Date();
    const result: DockActionResult = { completed: [], pending: [] };
    for (const row of rows) {
      result.completed.push(
        await this.createTask({
          type: DockTaskType.SCAN_INBOUND,
          status: DockTaskStatus.COMPLETED,
          itemId: row.itemId,
          shipmentId: row.shipmentId,
          routeId: route.id,
          locationId: destination.locationId,
          inboundLegId: row.shipmentId,
          outboundLegId: null,
          performedBy: user.id,
          completedAt: now,
          metadata: { reason: DockEventType.MANUAL_DELIVERY },
        }),
      );
      await this.updateItem(row.itemId, {
        status: ItemStatus.DELIVERED,
        currentLocationId: destination.locationId,
        currentShipmentId: rootIds.get(row.shipmentId),
      });
    }
    await this.publish(
      DockEventType.MANUAL_DELIVERY,
      route.id,
      destination.locationId,
      result,
    );
    return result;
  }

  /** The non-deleted tasks of one route at one Location, oldest first. */
  async findTasks(query: ListDockTasksQueryDto): Promise<DockTaskRow[]> {
    const route = await this.findRoute(query.routeId);
    const tasks = await this.dockTaskModel
      .find({
        routeId: route.id,
        locationId: query.locationId,
        status: query.status,
        deletedAt: null,
      })
      .sort({ createdAt: 1, id: 1 })
      .lean<DockTask[]>();
    return tasks.map((task) => {
      const row =
        route.items.find(
          (entry) =>
            entry.itemId === task.itemId &&
            entry.shipmentId === task.shipmentId,
        ) ?? route.items.find((entry) => entry.itemId === task.itemId);
      return {
        task,
        itemCode: row?.itemCode ?? null,
        barcode: row?.barcode ?? null,
      };
    });
  }

  /** §5: after a scan-in, scan out on the route of the next leg, from this dock. */
  private async nextAfterScanIn(task: DockTask): Promise<NewTask | null> {
    const leg = await this.findShipment(task.shipmentId);
    const root = leg.parentId ? await this.findShipment(leg.parentId) : null;
    const nextLegId = root?.childrenIds[root.childrenIds.indexOf(leg.id) + 1];
    const nextRoute =
      nextLegId &&
      (await this.routeModel
        .findOne({ shipmentIds: nextLegId, deletedAt: null })
        .lean<Route>());
    if (!nextLegId || !nextRoute) {
      return null;
    }
    return {
      type: DockTaskType.SCAN_OUTBOUND,
      itemId: task.itemId,
      shipmentId: nextLegId,
      routeId: nextRoute.id,
      locationId: task.locationId,
      inboundLegId: null,
      outboundLegId: nextLegId,
    };
  }

  /** §5: after a scan-out toward a dock, scan in there on the same route. */
  private async nextAfterScanOut(
    task: DockTask,
    route: Route,
  ): Promise<NewTask | null> {
    const { destination } = routeEnds(route);
    const location = await this.locationsService.findById(
      destination.locationId,
    );
    if (location.type === LocationType.STORE) {
      return null;
    }
    const legId = task.outboundLegId ?? task.shipmentId;
    return {
      type: DockTaskType.SCAN_INBOUND,
      itemId: task.itemId,
      shipmentId: legId,
      routeId: route.id,
      locationId: destination.locationId,
      inboundLegId: legId,
      outboundLegId: null,
    };
  }

  /** Publishes the action's event. The facts are already saved, so a failure is only logged. */
  private async publish(
    type: DockEventType,
    routeId: string,
    locationId: string,
    result: DockActionResult,
  ): Promise<void> {
    try {
      await this.publisher.publish({
        type,
        routeId,
        locationId,
        itemIds: [...new Set(result.completed.map((task) => task.itemId))],
        taskIds: result.completed.map((task) => task.id),
      });
    } catch (error) {
      this.logger.error(
        `${type} on route ${routeId} was saved but not published (${(error as Error).message}); ` +
          'republishPendingRollups() sends it again.',
      );
    }
  }

  private async createTask(fields: NewTask): Promise<DockTask> {
    const taskNumber = await this.metadataService.nextBusinessCode(
      BusinessCodeType.DOCK_TASK,
      new Date(),
    );
    const task = await this.dockTaskModel.create({ ...fields, taskNumber });
    return task.toObject();
  }

  /** Inserts a PENDING task unless the item already has the same one open (§5). */
  private async addPending(
    result: DockActionResult,
    fields: NewTask,
  ): Promise<void> {
    const exists = await this.dockTaskModel.exists({
      itemId: fields.itemId,
      type: fields.type,
      routeId: fields.routeId,
      locationId: fields.locationId,
      status: DockTaskStatus.PENDING,
      deletedAt: null,
    });
    if (!exists) {
      result.pending.push(
        await this.createTask({ ...fields, status: DockTaskStatus.PENDING }),
      );
    }
  }

  /** Completes a task only if it is still PENDING; `null` otherwise. */
  private completePending(
    id: string,
    changes: Record<string, unknown>,
  ): Promise<DockTask | null> {
    return this.dockTaskModel
      .findOneAndUpdate(
        { id, status: DockTaskStatus.PENDING, deletedAt: null },
        { $set: { ...changes, status: DockTaskStatus.COMPLETED } },
        { new: true, runValidators: true },
      )
      .lean<DockTask>();
  }

  private async updateItem(id: string, changes: Partial<Item>): Promise<void> {
    await this.itemModel.updateOne(
      { id, deletedAt: null },
      { $set: changes },
      { runValidators: true },
    );
  }

  private async savePhoto(
    taskId: string,
    extension: string,
    content: Buffer,
  ): Promise<string> {
    await mkdir(this.podDir, { recursive: true });
    const path = join(this.podDir, `${taskId}.${extension}`);
    await writeFile(path, content);
    return path;
  }

  private async findRoute(id: string): Promise<Route> {
    const route = await this.routeModel
      .findOne({ id, deletedAt: null })
      .lean<Route>();
    if (!route) {
      throw new NotFoundException(`Route ${id} not found`);
    }
    return route;
  }

  private async findShipment(id: string): Promise<Shipment> {
    const shipment = await this.shipmentModel
      .findOne({ id, deletedAt: null })
      .lean<Shipment>();
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    return shipment;
  }

  /** The booking a leg belongs to. */
  private async rootIdOf(legId: string): Promise<string> {
    const leg = await this.findShipment(legId);
    return leg.parentId ?? leg.id;
  }

  private async itemsOf(route: Route): Promise<Map<string, Item>> {
    const items = await this.itemModel
      .find({
        id: { $in: route.items.map((row) => row.itemId) },
        deletedAt: null,
      })
      .lean<Item[]>();
    return new Map(items.map((item) => [item.id, item]));
  }

  private async assertLocationType(
    locationId: string,
    type: LocationType,
    message: string,
  ): Promise<void> {
    const location = await this.locationsService.findById(locationId);
    if (location.type !== type) {
      throw new ConflictException(message);
    }
  }
}

/** A JPEG or PNG photo, checked by its type and its first bytes. */
function photoExtension(photo: UploadedPhoto | undefined): string {
  if (!photo) {
    throw new BadRequestException(
      'photo is required: an image/jpeg or image/png file',
    );
  }
  const accepted = PHOTO_TYPES[photo.mimetype];
  const matches = accepted?.signature.every(
    (byte, index) => photo.buffer[index] === byte,
  );
  if (!accepted || !matches) {
    throw new BadRequestException(
      'photo must be an image/jpeg or image/png file',
    );
  }
  return accepted.extension;
}
