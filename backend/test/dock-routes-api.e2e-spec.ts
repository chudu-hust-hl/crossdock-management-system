import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeliveryPointStatus } from '../src/common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../src/common/enums/delivery-point-type.enum';
import { generateUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { DockTaskStatus } from '../src/modules/dock-tasks/enums/dock-task-status.enum';
import { DockTaskType } from '../src/modules/dock-tasks/enums/dock-task-type.enum';
import { DockTask } from '../src/modules/dock-tasks/schemas/dock-task.schema';
import { LocationType } from '../src/modules/locations/enums/location-type.enum';
import { Location } from '../src/modules/locations/schemas/location.schema';
import {
  ROUTE_CREATED_BY,
  ROUTE_DRIVER_NAME,
  ROUTE_VEHICLE_PLATE,
} from '../src/modules/routes/route-assignment.constants';
import { RouteSlot } from '../src/modules/routes/enums/route-slot.enum';
import { RouteStatus } from '../src/modules/routes/enums/route-status.enum';
import { Route } from '../src/modules/routes/schemas/route.schema';
import { RoutesModule } from '../src/modules/routes/routes.module';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_dock_routes_api';

describe('GET /docks/:locationId/routes (integration)', () => {
  let app: INestApplication<App>;
  let routeModel: Model<Route>;
  let locationModel: Model<Location>;
  let dockTaskModel: Model<DockTask>;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), AuthModule, RoutesModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    routeModel = moduleRef.get(getModelToken(Route.name));
    locationModel = moduleRef.get(getModelToken(Location.name));
    dockTaskModel = moduleRef.get(getModelToken(DockTask.name));
    await Promise.all(
      [routeModel, locationModel, dockTaskModel].map((model) => model.init()),
    );
  });

  afterAll(async () => {
    await routeModel.db.dropDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(
      [routeModel, locationModel, dockTaskModel].map((model) =>
        model.deleteMany({}),
      ),
    );
  });

  async function makeLocation(
    name: string,
    type: LocationType,
    province: string,
    deletedAt?: Date,
  ): Promise<Location> {
    return locationModel.create({
      name,
      type,
      address: { addressLine1: '1 Dai Co Viet', province, postalCode: '10000' },
      ...(deletedAt && { deletedAt }),
    });
  }

  async function makeRoute(input: {
    routeNumber: string;
    fromLocationId: string;
    toLocationId: string;
    fromType?: DeliveryPointType;
    toType?: DeliveryPointType;
    fromStatus?: DeliveryPointStatus;
    toStatus?: DeliveryPointStatus;
    shipmentIds?: string[];
    status?: RouteStatus;
    serviceDate?: string;
    slot?: RouteSlot;
    appointmentFrom: string;
    deletedAt?: Date;
  }): Promise<Route> {
    const shipmentIds = input.shipmentIds ?? [];
    const from = new Date(input.appointmentFrom);
    return routeModel.create({
      routeNumber: input.routeNumber,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      driverName: ROUTE_DRIVER_NAME,
      vehiclePlate: ROUTE_VEHICLE_PLATE,
      createdBy: ROUTE_CREATED_BY,
      status: input.status ?? RouteStatus.PLANNED,
      shipmentIds,
      stops: [
        {
          sequence: 1,
          locationId: input.fromLocationId,
          type: input.fromType ?? DeliveryPointType.TRANSIT,
          shipmentIds: [...shipmentIds],
          appointment: { from: null, to: null },
          actualWindow: { from: null, to: null },
          status: input.fromStatus ?? DeliveryPointStatus.PENDING,
        },
        {
          sequence: 2,
          locationId: input.toLocationId,
          type: input.toType ?? DeliveryPointType.TRANSIT,
          shipmentIds: [...shipmentIds],
          appointment: { from: null, to: null },
          actualWindow: { from: null, to: null },
          status: input.toStatus ?? DeliveryPointStatus.PENDING,
        },
      ],
      ...(input.serviceDate != null && { serviceDate: input.serviceDate }),
      ...(input.slot != null && { slot: input.slot }),
      appointment: {
        from,
        to: new Date(from.getTime() + 4 * 60 * 60 * 1000),
      },
      ...(input.deletedAt && { deletedAt: input.deletedAt }),
    });
  }

  async function makeTask(input: {
    taskNumber: string;
    routeId: string;
    locationId: string;
    status?: DockTaskStatus;
    deletedAt?: Date;
  }): Promise<void> {
    await dockTaskModel.create({
      taskNumber: input.taskNumber,
      itemId: generateUlid(),
      shipmentId: generateUlid(),
      routeId: input.routeId,
      locationId: input.locationId,
      type: DockTaskType.SCAN_INBOUND,
      ...(input.status && { status: input.status }),
      ...(input.deletedAt && { deletedAt: input.deletedAt }),
    });
  }

  it('lists a dock–dock route outbound at its origin and inbound at its destination', async () => {
    const origin = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    const destination = await makeLocation(
      'Hai Phong Dock',
      LocationType.CROSS_DOCK,
      'Hai Phong',
    );
    const trunk = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: origin.id,
      toLocationId: destination.id,
      fromStatus: DeliveryPointStatus.ARRIVED,
      toStatus: DeliveryPointStatus.PROCESSING,
      shipmentIds: [generateUlid()],
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
      appointmentFrom: '2026-11-18T01:00:00.000Z',
    });

    const outbound = await http()
      .get(`/docks/${origin.id}/routes`)
      .query({ direction: 'outbound' })
      .expect(200);
    expect(outbound.body).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      items: [
        {
          id: trunk.id,
          routeNumber: 'R-0001-1126',
          status: RouteStatus.PLANNED,
          serviceDate: '2026-11-18',
          slot: RouteSlot.MORNING,
          shipmentCount: 1,
          otherEnd: {
            id: destination.id,
            name: 'Hai Phong Dock',
            province: 'Hai Phong',
          },
          stopSequence: 1,
          stopStatus: DeliveryPointStatus.ARRIVED,
          pendingTaskCount: 0,
        },
      ],
    });

    const inbound = await http()
      .get(`/docks/${destination.id}/routes`)
      .query({ direction: 'inbound' })
      .expect(200);
    expect(inbound.body.items).toEqual([
      expect.objectContaining({
        id: trunk.id,
        otherEnd: {
          id: origin.id,
          name: 'Hanoi Dock',
          province: 'Hanoi',
        },
        stopSequence: 2,
        stopStatus: DeliveryPointStatus.PROCESSING,
      }),
    ]);
  });

  it('lists a store–dock route inbound only at its dock', async () => {
    const store = await makeLocation(
      'Bac Bo Store',
      LocationType.STORE,
      'Hanoi',
    );
    const dock = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    const dedicated = await makeRoute({
      routeNumber: 'R-0002-1126',
      fromLocationId: store.id,
      toLocationId: dock.id,
      fromType: DeliveryPointType.PICKUP,
      toStatus: DeliveryPointStatus.PENDING,
      appointmentFrom: '2026-11-18T02:00:00.000Z',
    });

    const inbound = await http()
      .get(`/docks/${dock.id}/routes`)
      .query({ direction: 'inbound' })
      .expect(200);
    expect(inbound.body.items).toEqual([
      expect.objectContaining({
        id: dedicated.id,
        otherEnd: { id: store.id, name: 'Bac Bo Store', province: 'Hanoi' },
        stopSequence: 2,
        stopStatus: DeliveryPointStatus.PENDING,
      }),
    ]);
    expect(inbound.body.items[0]).not.toHaveProperty('serviceDate');
    expect(inbound.body.items[0]).not.toHaveProperty('slot');

    const outbound = await http()
      .get(`/docks/${dock.id}/routes`)
      .query({ direction: 'outbound' })
      .expect(200);
    expect(outbound.body).toMatchObject({ total: 0, items: [] });

    await http()
      .get(`/docks/${store.id}/routes`)
      .query({ direction: 'inbound' })
      .expect(404);
  });

  it('answers 404 for a missing or deleted dock and 400 for a non-ULID', async () => {
    const deleted = await makeLocation(
      'Closed Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
      new Date('2026-11-01T00:00:00.000Z'),
    );
    await http()
      .get(`/docks/${deleted.id}/routes`)
      .query({ direction: 'inbound' })
      .expect(404);
    await http()
      .get(`/docks/${generateUlid()}/routes`)
      .query({ direction: 'inbound' })
      .expect(404);
    await http()
      .get('/docks/not-a-ulid/routes')
      .query({ direction: 'inbound' })
      .expect(400);
  });

  it('requires direction and rejects an unknown parameter', async () => {
    const dock = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    await http().get(`/docks/${dock.id}/routes`).expect(400);
    await http()
      .get(`/docks/${dock.id}/routes`)
      .query({ direction: 'sideways' })
      .expect(400);
    await http()
      .get(`/docks/${dock.id}/routes`)
      .query({ direction: 'inbound', sortBy: 'id' })
      .expect(400);
  });

  it('counts only non-deleted PENDING tasks and does not query per row', async () => {
    const origin = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    const destination = await makeLocation(
      'Hai Phong Dock',
      LocationType.CROSS_DOCK,
      'Hai Phong',
    );
    const store = await makeLocation(
      'Bac Bo Store',
      LocationType.STORE,
      'Hanoi',
    );
    const missingId = generateUlid();
    const trunk = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: origin.id,
      toLocationId: destination.id,
      fromStatus: DeliveryPointStatus.ARRIVED,
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
      shipmentIds: [generateUlid(), generateUlid()],
      appointmentFrom: '2026-11-18T03:00:00.000Z',
    });
    const dedicated = await makeRoute({
      routeNumber: 'R-0002-1126',
      fromLocationId: store.id,
      toLocationId: destination.id,
      fromType: DeliveryPointType.PICKUP,
      toStatus: DeliveryPointStatus.PROCESSING,
      appointmentFrom: '2026-11-18T01:00:00.000Z',
    });
    const missingOrigin = await makeRoute({
      routeNumber: 'R-0003-1126',
      fromLocationId: missingId,
      toLocationId: destination.id,
      serviceDate: '2026-11-19',
      slot: RouteSlot.EVENING,
      appointmentFrom: '2026-11-18T02:00:00.000Z',
    });
    await makeRoute({
      routeNumber: 'R-0004-1126',
      fromLocationId: origin.id,
      toLocationId: destination.id,
      serviceDate: '2026-11-20',
      slot: RouteSlot.MORNING,
      appointmentFrom: '2026-11-18T00:00:00.000Z',
      deletedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    await makeTask({
      taskNumber: '0001-1126',
      routeId: trunk.id,
      locationId: origin.id,
    });
    await makeTask({
      taskNumber: '0002-1126',
      routeId: trunk.id,
      locationId: origin.id,
    });
    await makeTask({
      taskNumber: '0003-1126',
      routeId: trunk.id,
      locationId: origin.id,
      status: DockTaskStatus.COMPLETED,
    });
    await makeTask({
      taskNumber: '0004-1126',
      routeId: trunk.id,
      locationId: origin.id,
      deletedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    await makeTask({
      taskNumber: '0005-1126',
      routeId: trunk.id,
      locationId: destination.id,
    });
    await makeTask({
      taskNumber: '0006-1126',
      routeId: dedicated.id,
      locationId: destination.id,
      status: DockTaskStatus.COMPLETED,
    });

    const outbound = await http()
      .get(`/docks/${origin.id}/routes`)
      .query({ direction: 'outbound' })
      .expect(200);
    expect(outbound.body.items).toEqual([
      expect.objectContaining({
        id: trunk.id,
        pendingTaskCount: 2,
        stopSequence: 1,
        stopStatus: DeliveryPointStatus.ARRIVED,
      }),
    ]);

    const queries: string[] = [];
    const previous = mongoose.get('debug');
    mongoose.set('debug', (collection: string, method: string) => {
      queries.push(`${collection}.${method}`);
    });
    let inbound: request.Response;
    try {
      inbound = await http()
        .get(`/docks/${destination.id}/routes`)
        .query({ direction: 'inbound', status: RouteStatus.PLANNED })
        .expect(200);
    } finally {
      mongoose.set('debug', previous);
    }

    expect(inbound.body.total).toBe(3);
    expect(inbound.body.items.map((item: { id: string }) => item.id)).toEqual([
      dedicated.id,
      missingOrigin.id,
      trunk.id,
    ]);
    expect(inbound.body.items[0]).toMatchObject({
      id: dedicated.id,
      otherEnd: { id: store.id, name: 'Bac Bo Store', province: 'Hanoi' },
      stopSequence: 2,
      stopStatus: DeliveryPointStatus.PROCESSING,
      pendingTaskCount: 0,
    });
    expect(inbound.body.items[1]).toMatchObject({
      id: missingOrigin.id,
      otherEnd: { id: missingId, name: null, province: null },
      pendingTaskCount: 0,
    });
    expect(inbound.body.items[2]).toMatchObject({
      id: trunk.id,
      pendingTaskCount: 1,
      shipmentCount: 2,
    });
    expect(queries.filter((query) => query === 'locations.find')).toEqual([
      'locations.find',
    ]);
    expect(queries.filter((query) => query.startsWith('dock_tasks'))).toEqual([
      'dock_tasks.aggregate',
    ]);
  });
});
