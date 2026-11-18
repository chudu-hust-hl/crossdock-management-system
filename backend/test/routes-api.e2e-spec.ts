import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeliveryPointType } from '../src/common/enums/delivery-point-type.enum';
import { generateUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { DockTaskType } from '../src/modules/dock-tasks/enums/dock-task-type.enum';
import { DockTask } from '../src/modules/dock-tasks/schemas/dock-task.schema';
import { ItemUnit } from '../src/modules/items/enums/item-unit.enum';
import { WeightUnit } from '../src/modules/items/enums/weight-unit.enum';
import { Item } from '../src/modules/items/schemas/item.schema';
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
import { ShipmentStatus } from '../src/modules/shipments/enums/shipment-status.enum';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { User } from '../src/modules/users/schemas/user.schema';
import { bearer, tokenFor } from './utils/test-auth';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_routes_api';

describe('Routes API (integration)', () => {
  let app: INestApplication<App>;
  let routeModel: Model<Route>;
  let shipmentModel: Model<Shipment>;
  let locationModel: Model<Location>;
  let itemModel: Model<Item>;
  let dockTaskModel: Model<DockTask>;
  let models: Model<unknown>[];
  let managerToken: string;
  let adminToken: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), AuthModule, RoutesModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    routeModel = moduleRef.get(getModelToken(Route.name));
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    locationModel = moduleRef.get(getModelToken(Location.name));
    itemModel = moduleRef.get(getModelToken(Item.name));
    dockTaskModel = moduleRef.get(getModelToken(DockTask.name));
    models = [Route, Shipment, Location, Item, DockTask, User].map((model) =>
      moduleRef.get<Model<unknown>>(getModelToken(model.name)),
    );
    await Promise.all(models.map((model) => model.init()));
    managerToken = await tokenFor(moduleRef, UserRole.DOCK_MANAGER);
    adminToken = await tokenFor(moduleRef, UserRole.ADMIN);
  });

  afterAll(async () => {
    await routeModel.db.dropDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(
      [routeModel, shipmentModel, locationModel, itemModel, dockTaskModel].map(
        (model) => model.deleteMany({}),
      ),
    );
  });

  async function makeLocation(
    name: string,
    type: LocationType,
    province: string,
  ): Promise<Location> {
    return locationModel.create({
      name,
      type,
      address: { addressLine1: '1 Dai Co Viet', province, postalCode: '10000' },
    });
  }

  async function makeItem(
    itemCode: string,
    description?: string,
  ): Promise<Item> {
    return itemModel.create({
      itemCode,
      barcode: `BC-${itemCode}`,
      ...(description && { description }),
      itemUnit: ItemUnit.BOX,
      weight: 2.5,
      weightUnit: WeightUnit.KG,
    });
  }

  function point(
    sequence: number,
    locationId: string,
    type: DeliveryPointType,
  ) {
    return {
      sequence,
      locationId,
      type,
      appointment: { from: null, to: null },
      actualWindow: { from: null, to: null },
      status: 'PENDING',
    };
  }

  async function makeChild(input: {
    code: string;
    parentId: string;
    itemIds: string[];
    fromLocationId: string;
    toLocationId: string;
    status?: ShipmentStatus;
  }): Promise<Shipment> {
    return shipmentModel.create({
      code: input.code,
      parentId: input.parentId,
      itemIds: input.itemIds,
      status: input.status ?? ShipmentStatus.CREATED,
      deliveryInfos: [
        point(1, input.fromLocationId, DeliveryPointType.TRANSIT),
        point(2, input.toLocationId, DeliveryPointType.TRANSIT),
      ],
    });
  }

  async function makeRoute(input: {
    routeNumber: string;
    fromLocationId: string;
    toLocationId: string;
    shipmentIds?: string[];
    status?: RouteStatus;
    serviceDate?: string;
    slot?: RouteSlot;
    appointmentFrom?: string;
    items?: Route['items'];
    deletedAt?: Date;
  }): Promise<Route> {
    const shipmentIds = input.shipmentIds ?? [];
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
          ...point(1, input.fromLocationId, DeliveryPointType.TRANSIT),
          shipmentIds: [...shipmentIds],
        },
        {
          ...point(2, input.toLocationId, DeliveryPointType.TRANSIT),
          shipmentIds: [...shipmentIds],
        },
      ],
      items: input.items ?? [],
      ...(input.serviceDate != null && { serviceDate: input.serviceDate }),
      ...(input.slot != null && { slot: input.slot }),
      appointment: {
        from: new Date(input.appointmentFrom ?? '2026-11-18T01:00:00.000Z'),
        to: new Date(
          new Date(
            input.appointmentFrom ?? '2026-11-18T01:00:00.000Z',
          ).getTime() +
            4 * 60 * 60 * 1000,
        ),
      },
      ...(input.deletedAt && { deletedAt: input.deletedAt }),
    });
  }

  it('lists non-deleted routes with filters, paging, and a missing location', async () => {
    const hanoi = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    const danang = await makeLocation(
      'Da Nang Dock',
      LocationType.CROSS_DOCK,
      'Da Nang',
    );
    const missingId = generateUlid();
    const sameFrom = '2026-11-17T01:00:00.000Z';
    const earlier = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: hanoi.id,
      toLocationId: danang.id,
      serviceDate: '2026-11-17',
      slot: RouteSlot.MORNING,
      appointmentFrom: sameFrom,
    });
    const laterSameTime = await makeRoute({
      routeNumber: 'R-0002-1126',
      fromLocationId: hanoi.id,
      toLocationId: danang.id,
      serviceDate: '2026-11-17',
      slot: RouteSlot.EVENING,
      appointmentFrom: sameFrom,
    });
    await makeRoute({
      routeNumber: 'R-0003-1126',
      fromLocationId: hanoi.id,
      toLocationId: danang.id,
      status: RouteStatus.IN_PROGRESS,
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
      appointmentFrom: '2026-11-18T01:00:00.000Z',
    });
    await makeRoute({
      routeNumber: 'R-0004-1126',
      fromLocationId: missingId,
      toLocationId: danang.id,
      serviceDate: '2026-11-19',
      slot: RouteSlot.EVENING,
      appointmentFrom: '2026-11-19T11:00:00.000Z',
    });
    await makeRoute({
      routeNumber: 'R-0005-1126',
      fromLocationId: hanoi.id,
      toLocationId: danang.id,
      deletedAt: new Date(),
      appointmentFrom: '2026-11-16T01:00:00.000Z',
    });

    const listed = await http().get('/routes').expect(200);
    expect(listed.body).toMatchObject({ page: 1, limit: 20, total: 4 });
    expect(
      listed.body.items.map((row: { routeNumber: string }) => row.routeNumber),
    ).toEqual(['R-0001-1126', 'R-0002-1126', 'R-0003-1126', 'R-0004-1126']);
    expect(listed.body.items[0].id < listed.body.items[1].id).toBe(true);
    expect(earlier.id < laterSameTime.id).toBe(true);
    expect(listed.body.items[0]).toMatchObject({
      shipmentCount: 0,
      serviceDate: '2026-11-17',
      slot: 'MORNING',
      from: {
        id: hanoi.id,
        name: 'Hanoi Dock',
        type: 'CROSS_DOCK',
        province: 'Hanoi',
      },
      to: {
        id: danang.id,
        name: 'Da Nang Dock',
        type: 'CROSS_DOCK',
        province: 'Da Nang',
      },
    });
    expect(listed.body.items[3].from).toEqual({
      id: missingId,
      name: null,
      type: null,
      province: null,
    });

    const planned = await http().get('/routes?status=PLANNED').expect(200);
    expect(planned.body.total).toBe(3);
    expect(
      planned.body.items.every(
        (row: { status: string }) => row.status === 'PLANNED',
      ),
    ).toBe(true);

    const byNumber = await http().get('/routes?routeNumber=r-0001').expect(200);
    expect(
      byNumber.body.items.map(
        (row: { routeNumber: string }) => row.routeNumber,
      ),
    ).toEqual(['R-0001-1126']);

    const byDate = await http()
      .get('/routes?serviceDate=2026-11-18')
      .expect(200);
    expect(
      byDate.body.items.map((row: { routeNumber: string }) => row.routeNumber),
    ).toEqual(['R-0003-1126']);

    const bySlot = await http().get('/routes?slot=EVENING').expect(200);
    expect(
      bySlot.body.items.map((row: { routeNumber: string }) => row.routeNumber),
    ).toEqual(['R-0002-1126', 'R-0004-1126']);

    await http().get('/routes?nope=1').expect(400);
  });

  it('returns the route with stop names and the root customer', async () => {
    const from = await makeLocation(
      'Hanoi Dock',
      LocationType.CROSS_DOCK,
      'Hanoi',
    );
    const to = await makeLocation(
      'Da Nang Dock',
      LocationType.CROSS_DOCK,
      'Da Nang',
    );
    const item = await makeItem('T-0001-1126', 'A box of tea');
    const root = await shipmentModel.create({
      code: 'S-0001-1126',
      customerName: 'Cong ty ABC',
      cost: 1000,
      itemIds: [item.id],
    });
    const child = await makeChild({
      code: 'S-0002-1126',
      parentId: root.id,
      itemIds: [item.id, generateUlid()],
      fromLocationId: from.id,
      toLocationId: to.id,
    });
    const route = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      shipmentIds: [child.id, generateUlid()],
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
    });

    const response = await http().get(`/routes/${route.id}`).expect(200);
    expect(response.body.route).toMatchObject({
      id: route.id,
      routeNumber: 'R-0001-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
    });
    expect(response.body.locations).toEqual([
      expect.objectContaining({
        id: from.id,
        name: 'Hanoi Dock',
        type: 'CROSS_DOCK',
        address: expect.objectContaining({ province: 'Hanoi' }),
      }),
      expect.objectContaining({
        id: to.id,
        name: 'Da Nang Dock',
        type: 'CROSS_DOCK',
        address: expect.objectContaining({ province: 'Da Nang' }),
      }),
    ]);
    expect(response.body.shipments).toEqual([
      {
        id: child.id,
        code: 'S-0002-1126',
        status: 'CREATED',
        parentId: root.id,
        customerName: 'Cong ty ABC',
        itemCount: 2,
      },
    ]);

    await http().get('/routes/not-a-ulid').expect(400);
    await http().get(`/routes/${generateUlid()}`).expect(404);
  });

  it('lists candidates that share the two ends and are not already on the route', async () => {
    const from = await makeLocation('A', LocationType.CROSS_DOCK, 'Hanoi');
    const to = await makeLocation('B', LocationType.CROSS_DOCK, 'Da Nang');
    const other = await makeLocation('C', LocationType.CROSS_DOCK, 'Hue');
    const root = await shipmentModel.create({
      code: 'S-0001-1126',
      customerName: 'Cong ty ABC',
      cost: 1000,
    });
    const item = await makeItem('T-0001-1126');
    const already = await makeChild({
      code: 'S-0002-1126',
      parentId: root.id,
      itemIds: [item.id],
      fromLocationId: from.id,
      toLocationId: to.id,
    });
    const differentEnds = await makeChild({
      code: 'S-0003-1126',
      parentId: root.id,
      itemIds: [item.id],
      fromLocationId: from.id,
      toLocationId: other.id,
    });
    const movable = await makeChild({
      code: 'S-0004-1126',
      parentId: root.id,
      itemIds: [item.id, generateUlid()],
      fromLocationId: from.id,
      toLocationId: to.id,
    });
    const route = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      shipmentIds: [already.id],
    });
    await makeRoute({
      routeNumber: 'R-0002-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      shipmentIds: [movable.id],
      serviceDate: '2026-11-19',
      slot: RouteSlot.MORNING,
    });

    const response = await http()
      .get(`/routes/${route.id}/candidates`)
      .expect(200);
    expect(response.body).toEqual([
      {
        id: movable.id,
        code: 'S-0004-1126',
        parentCode: 'S-0001-1126',
        customerName: 'Cong ty ABC',
        itemCount: 2,
      },
    ]);
    expect(response.body.map((row: { id: string }) => row.id)).not.toContain(
      already.id,
    );
    expect(response.body.map((row: { id: string }) => row.id)).not.toContain(
      differentEnds.id,
    );

    const empty = await makeRoute({
      routeNumber: 'R-0003-1126',
      fromLocationId: other.id,
      toLocationId: from.id,
      serviceDate: '2026-11-20',
      slot: RouteSlot.EVENING,
    });
    await http().get(`/routes/${empty.id}/candidates`).expect(200).expect([]);
    await http().get(`/routes/${generateUlid()}/candidates`).expect(404);
  });

  it('moves a child, soft-deletes the emptied route, and copies the snapshot', async () => {
    const from = await makeLocation('A', LocationType.CROSS_DOCK, 'Hanoi');
    const to = await makeLocation('B', LocationType.CROSS_DOCK, 'Da Nang');
    const item = await makeItem('T-0001-1126', 'A box of tea');
    const root = await shipmentModel.create({
      code: 'S-0001-1126',
      customerName: 'Cong ty ABC',
      cost: 1000,
      itemIds: [item.id],
    });
    const child = await makeChild({
      code: 'S-0002-1126',
      parentId: root.id,
      itemIds: [item.id],
      fromLocationId: from.id,
      toLocationId: to.id,
    });
    const source = await makeRoute({
      routeNumber: 'R-0001-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      shipmentIds: [child.id],
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
      items: [
        {
          itemId: item.id,
          shipmentId: child.id,
          itemCode: item.itemCode,
          barcode: 'old-barcode',
          itemUnit: ItemUnit.BOX,
          weight: 1,
          weightUnit: WeightUnit.KG,
        },
      ],
    });
    const target = await makeRoute({
      routeNumber: 'R-0002-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      serviceDate: '2026-11-19',
      slot: RouteSlot.EVENING,
    });

    const response = await http()
      .post(`/routes/${target.id}/shipments`)
      .set('Authorization', bearer(managerToken))
      .send({ shipmentIds: [child.id] })
      .expect(200);

    expect(response.body.route.shipmentIds).toEqual([child.id]);
    expect(response.body.route.stops).toHaveLength(2);
    expect(response.body.route.stops[0]).toMatchObject({
      sequence: 1,
      locationId: from.id,
      shipmentIds: [child.id],
    });
    expect(response.body.route.stops[1]).toMatchObject({
      sequence: 2,
      locationId: to.id,
      shipmentIds: [child.id],
    });
    expect(response.body.route.driverName).toBe(ROUTE_DRIVER_NAME);
    expect(response.body.route.vehiclePlate).toBe(ROUTE_VEHICLE_PLATE);
    expect(response.body.shipments).toEqual([
      expect.objectContaining({
        id: child.id,
        customerName: 'Cong ty ABC',
        itemCount: 1,
      }),
    ]);

    const stored = await routeModel.findOne({ id: target.id }).lean();
    expect(stored?.items).toEqual([
      expect.objectContaining({
        itemId: item.id,
        shipmentId: child.id,
        itemCode: 'T-0001-1126',
        barcode: 'BC-T-0001-1126',
        description: 'A box of tea',
        itemUnit: 'BOX',
        weight: 2.5,
        weightUnit: 'KG',
      }),
    ]);

    const emptied = await routeModel.findOne({ id: source.id }).lean();
    expect(emptied?.shipmentIds).toEqual([]);
    expect(emptied?.items).toEqual([]);
    expect(emptied?.deletedAt).toBeInstanceOf(Date);
    expect(emptied?.stops.every((stop) => stop.shipmentIds.length === 0)).toBe(
      true,
    );

    const still = await shipmentModel.findOne({ id: child.id }).lean();
    expect(still).toMatchObject({
      status: 'CREATED',
      parentId: root.id,
      itemIds: [item.id],
    });
    expect(await dockTaskModel.countDocuments()).toBe(0);
  });

  it('rejects the move when the route is not PLANNED', async () => {
    const { target, child, source } = await plannedPair(
      RouteStatus.IN_PROGRESS,
    );
    await http()
      .post(`/routes/${target.id}/shipments`)
      .set('Authorization', bearer(managerToken))
      .send({ shipmentIds: [child.id] })
      .expect(409);
    await expectUnchanged(source.id, target.id, child.id);
  });

  it('rejects the move when the child is not CREATED', async () => {
    const { target, child, source } = await plannedPair(
      RouteStatus.PLANNED,
      ShipmentStatus.IN_TRANSIT,
    );
    await http()
      .post(`/routes/${target.id}/shipments`)
      .set('Authorization', bearer(managerToken))
      .send({ shipmentIds: [child.id] })
      .expect(409);
    await expectUnchanged(source.id, target.id, child.id);
  });

  it('rejects the move when the child already has a dock task', async () => {
    const { target, child, source, item, from } = await plannedPair();
    await dockTaskModel.create({
      taskNumber: '0001-1126',
      itemId: item.id,
      shipmentId: child.id,
      routeId: source.id,
      locationId: from.id,
      type: DockTaskType.SCAN_INBOUND,
    });
    await http()
      .post(`/routes/${target.id}/shipments`)
      .set('Authorization', bearer(managerToken))
      .send({ shipmentIds: [child.id] })
      .expect(409);
    await expectUnchanged(source.id, target.id, child.id);
  });

  it('rejects the move for an ADMIN', async () => {
    const { target, child, source } = await plannedPair();
    await http()
      .post(`/routes/${target.id}/shipments`)
      .set('Authorization', bearer(adminToken))
      .send({ shipmentIds: [child.id] })
      .expect(403);
    await expectUnchanged(source.id, target.id, child.id);
  });

  async function plannedPair(
    targetStatus: RouteStatus = RouteStatus.PLANNED,
    childStatus: ShipmentStatus = ShipmentStatus.CREATED,
  ) {
    const from = await makeLocation('A', LocationType.CROSS_DOCK, 'Hanoi');
    const to = await makeLocation('B', LocationType.CROSS_DOCK, 'Da Nang');
    const item = await makeItem('T-0009-1126', 'Tea');
    const root = await shipmentModel.create({
      code: 'S-0009-1126',
      customerName: 'Cong ty ABC',
      cost: 1000,
      itemIds: [item.id],
    });
    const child = await makeChild({
      code: 'S-0010-1126',
      parentId: root.id,
      itemIds: [item.id],
      fromLocationId: from.id,
      toLocationId: to.id,
      status: childStatus,
    });
    const source = await makeRoute({
      routeNumber: 'R-0008-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      shipmentIds: [child.id],
      serviceDate: '2026-11-18',
      slot: RouteSlot.MORNING,
    });
    const target = await makeRoute({
      routeNumber: 'R-0009-1126',
      fromLocationId: from.id,
      toLocationId: to.id,
      status: targetStatus,
      serviceDate: '2026-11-19',
      slot: RouteSlot.EVENING,
    });
    return { from, to, item, child, source, target };
  }

  async function expectUnchanged(
    sourceId: string,
    targetId: string,
    childId: string,
  ): Promise<void> {
    const source = await routeModel.findOne({ id: sourceId }).lean();
    const target = await routeModel.findOne({ id: targetId }).lean();
    expect(source?.deletedAt).toBeNull();
    expect(source?.shipmentIds).toEqual([childId]);
    expect(target?.shipmentIds).toEqual([]);
  }
});
