import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { Model } from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { DockEventFields } from '../src/modules/dock-tasks/dock-event.message';
import { DockEventsPublisher } from '../src/modules/dock-tasks/dock-events.publisher';
import { DockTasksModule } from '../src/modules/dock-tasks/dock-tasks.module';
import {
  DockActionResponse,
  DockTaskRowResponse,
} from '../src/modules/dock-tasks/dto/dock-task-response.dto';
import { DockTask } from '../src/modules/dock-tasks/schemas/dock-task.schema';
import { StatusRollupService } from '../src/modules/dock-tasks/status-rollup.service';
import { Item } from '../src/modules/items/schemas/item.schema';
import { LocationType } from '../src/modules/locations/enums/location-type.enum';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { Metadata } from '../src/modules/metadata/schemas/metadata.schema';
import { Route } from '../src/modules/routes/schemas/route.schema';
import * as trunkSlot from '../src/modules/routes/trunk-slot';
import { Province } from '../src/modules/routing/schemas/province.schema';
import { ShipmentResponse } from '../src/modules/shipments/dto/shipment-response.dto';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { bearer, tokenFor } from './utils/test-auth';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI, but no RabbitMQ. The publisher
// is mocked and each test runs the rollup itself with the message it would have sent.
const TEST_DB_NAME = 'cross_dock_management_test_dock_tasks_api';
const POD_DIR = join(tmpdir(), `cross-dock-pod-${generateUlid()}`);

// Set before the configuration is loaded; they take precedence over backend/.env.
process.env.RABBITMQ_URL = '';
process.env.POD_DIR = POD_DIR;
process.env.PRICING_BASE_FEE = '20000';
process.env.PRICING_FEE_PER_ITEM = '5000';
process.env.PRICING_FEE_PER_KG = '3000';

/** The first bytes of a JPEG file are enough for the type check. */
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function store(name: string, postalCode: string, province: string) {
  return {
    name,
    contactName: `${name} Contact`,
    address: { addressLine1: `1 ${name} Street`, postalCode, province },
  };
}

/** Store A (Hanoi) → Store B (Ho Chi Minh City): three legs, the middle one shared. */
function booking(barcodePrefix: string) {
  return {
    customerName: 'Cong ty TNHH ABC',
    pickup: {
      location: store('Store A', '100000', 'Hanoi'),
      appointment: {
        from: '2026-11-10T01:00:00.000Z',
        to: '2026-11-10T03:00:00.000Z',
      },
    },
    dropoff: {
      location: store('Store B', '700000', 'Ho Chi Minh City'),
      appointment: {
        from: '2026-11-12T06:00:00.000Z',
        to: '2026-11-12T10:00:00.000Z',
      },
    },
    items: [1, 2].map((box) => ({
      barcode: `${barcodePrefix}-${box}`,
      itemUnit: 'BOX',
      weight: 1,
      weightUnit: 'KG',
    })),
  };
}

describe('Dock actions and status rollup (integration)', () => {
  let app: INestApplication<App>;
  let moduleRef: TestingModule;
  let rollup: StatusRollupService;
  let shipmentModel: Model<Shipment>;
  let routeModel: Model<Route>;
  let itemModel: Model<Item>;
  let dockTaskModel: Model<DockTask>;
  let locationModel: Model<Location>;
  let provinceModel: Model<Province>;
  let models: Model<unknown>[];
  let hanoiDockId: string;
  let hcmcDockId: string;
  let adminToken: string;
  let managerToken: string;
  let operatorToken: string;
  const publisher = {
    assertAvailable: jest.fn(),
    publish: jest.fn<Promise<void>, [DockEventFields]>(),
    republishPendingRollups: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ...testDatabaseImports(TEST_DB_NAME),
        AuthModule,
        ShipmentsModule,
        DockTasksModule,
      ],
    })
      .overrideProvider(DockEventsPublisher)
      .useValue(publisher)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    rollup = moduleRef.get(StatusRollupService);
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    routeModel = moduleRef.get(getModelToken(Route.name));
    itemModel = moduleRef.get(getModelToken(Item.name));
    dockTaskModel = moduleRef.get(getModelToken(DockTask.name));
    locationModel = moduleRef.get(getModelToken(Location.name));
    provinceModel = moduleRef.get(getModelToken(Province.name));
    models = [
      Shipment,
      Location,
      Item,
      Metadata,
      Province,
      Route,
      DockTask,
    ].map((model) => moduleRef.get<Model<unknown>>(getModelToken(model.name)));
    await Promise.all(models.map((model) => model.init()));
    adminToken = await tokenFor(moduleRef, UserRole.ADMIN);
    managerToken = await tokenFor(moduleRef, UserRole.DOCK_MANAGER);
    operatorToken = await tokenFor(moduleRef, UserRole.DOCK_OPERATOR);
  });

  beforeEach(async () => {
    await Promise.all(models.map((model) => model.deleteMany({})));
    publisher.publish.mockReset().mockResolvedValue(undefined);
    jest
      .spyOn(trunkSlot, 'bookingNow')
      .mockReturnValue(new Date('2026-11-07T02:00:00.000Z'));
    await provinceModel.create([
      { id: '01', name: { local: 'Hà Nội', en: 'Hanoi', slug: 'ha-noi-01' } },
      {
        id: '79',
        name: {
          local: 'Hồ Chí Minh',
          en: 'Ho Chi Minh City',
          slug: 'ho-chi-minh-79',
        },
      },
    ]);
    const docks = await locationModel.create(
      ['Hanoi', 'Ho Chi Minh City'].map((province) => ({
        name: `${province} Cross-Dock`,
        type: LocationType.CROSS_DOCK,
        address: {
          addressLine1: '1 Dock Road',
          postalCode: '000000',
          province,
        },
      })),
    );
    [hanoiDockId, hcmcDockId] = docks.map((dock) => dock.toObject().id);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await shipmentModel.db.dropDatabase();
    await app.close();
    await rm(POD_DIR, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  /** Books Store A → Store B and returns the root, its items and its three routes. */
  async function book(barcodePrefix: string) {
    const booked = (
      await http()
        .post('/shipments/book')
        .set('Authorization', bearer(adminToken))
        .send(booking(barcodePrefix))
        .expect(201)
    ).body as ShipmentResponse;
    const [leg1, leg2, leg3] = booked.childrenIds;
    const routeOf = async (legId: string) =>
      (await routeModel.findOne({ shipmentIds: legId }).lean<Route>())!;
    return {
      root: booked,
      storeAId: booked.deliveryInfos[0].locationId,
      legs: { leg1, leg2, leg3 },
      box1: booked.itemIds[0],
      box2: booked.itemIds[1],
      pickupRoute: await routeOf(leg1),
      trunkRoute: await routeOf(leg2),
      dropoffRoute: await routeOf(leg3),
    };
  }

  function post(path: string, token: string, body: object) {
    return http().post(path).set('Authorization', bearer(token)).send(body);
  }

  function scan(
    routeId: string,
    locationId: string,
    barcode: string,
    token = operatorToken,
  ) {
    return http()
      .post('/dock-tasks/scan')
      .set('Authorization', bearer(token))
      .field('routeId', routeId)
      .field('locationId', locationId)
      .field('barcode', barcode)
      .attach('photo', PHOTO, {
        filename: 'proof.jpg',
        contentType: 'image/jpeg',
      });
  }

  const lastMessage = (): DockEventFields => {
    const calls = publisher.publish.mock.calls;
    return calls[calls.length - 1][0];
  };
  /** What the consumer does with the message the last action published. */
  const rollUp = () => rollup.apply(lastMessage());

  const routeNow = async (id: string) =>
    (await routeModel.findOne({ id }).lean<Route>())!;
  const shipmentNow = async (id: string) =>
    (await shipmentModel.findOne({ id }).lean<Shipment>())!;
  const itemNow = async (id: string) =>
    (await itemModel.findOne({ id }).lean<Item>())!;
  const stopStatuses = (route: Route) => route.stops.map((stop) => stop.status);

  it('follows the worked example: one item does not finish a shared route; a missing item does', async () => {
    const b = await book('W');
    const operatorId = moduleRef
      .get(JwtService)
      .decode<{ sub: string }>(operatorToken).sub;

    // Confirm pickup at store A: both boxes leave on leg 1.
    const pickup = (
      await post('/dock-tasks/pickup', managerToken, {
        routeId: b.pickupRoute.id,
      }).expect(201)
    ).body as DockActionResponse;
    expect(pickup.completedTasks).toHaveLength(2);
    expect(pickup.pendingTasks).toEqual([
      expect.objectContaining({
        type: 'SCAN_INBOUND',
        status: 'PENDING',
        locationId: hanoiDockId,
        inboundLegId: b.legs.leg1,
      }),
      expect.objectContaining({ type: 'SCAN_INBOUND', status: 'PENDING' }),
    ]);
    expect(lastMessage()).toEqual({
      type: 'MANUAL_PICKUP',
      routeId: b.pickupRoute.id,
      locationId: b.storeAId,
      itemIds: [b.box1, b.box2],
      taskIds: pickup.completedTasks.map((task) => task.id),
    });
    // The request writes the items, not the route.
    expect((await routeNow(b.pickupRoute.id)).status).toBe('PLANNED');
    await rollUp();
    expect(await routeNow(b.pickupRoute.id)).toMatchObject({
      status: 'IN_PROGRESS',
      stops: [
        expect.objectContaining({ status: 'COMPLETED' }),
        expect.objectContaining({ status: 'PENDING' }),
      ],
    });
    expect((await shipmentNow(b.root.id)).status).toBe('IN_TRANSIT');

    // Scan in box 1 at dock A': the store–dock route is not finished yet.
    const scanIn = (
      await scan(b.pickupRoute.id, hanoiDockId, 'W-1').expect(201)
    ).body as DockActionResponse;
    expect(scanIn.completedTasks[0].performedBy).toBe(operatorId);
    const podPath = scanIn.completedTasks[0].metadata!.podPath as string;
    expect(existsSync(podPath)).toBe(true);
    expect(scanIn.pendingTasks).toEqual([
      expect.objectContaining({
        type: 'SCAN_OUTBOUND',
        routeId: b.trunkRoute.id,
        locationId: hanoiDockId,
        outboundLegId: b.legs.leg2,
      }),
    ]);
    await rollUp();
    const halfScanned = await routeNow(b.pickupRoute.id);
    expect(halfScanned.status).toBe('IN_PROGRESS');
    expect(stopStatuses(halfScanned)).toEqual(['COMPLETED', 'PROCESSING']);
    expect((await shipmentNow(b.legs.leg1)).status).toBe('IN_TRANSIT');

    // Scan in box 2: the route is COMPLETED, leg 1 and the root are AT_DOCK.
    await scan(b.pickupRoute.id, hanoiDockId, 'W-2').expect(201);
    await rollUp();
    expect((await routeNow(b.pickupRoute.id)).status).toBe('COMPLETED');
    expect((await shipmentNow(b.legs.leg1)).status).toBe('AT_DOCK');
    expect((await shipmentNow(b.root.id)).status).toBe('AT_DOCK');

    const atDock = (
      await http()
        .get(`/dock-tasks?locationId=${hanoiDockId}&routeId=${b.trunkRoute.id}`)
        .set('Authorization', bearer(operatorToken))
        .expect(200)
    ).body as DockTaskRowResponse[];
    expect(atDock.map((row) => [row.type, row.itemCode, row.barcode])).toEqual([
      ['SCAN_OUTBOUND', expect.any(String), 'W-1'],
      ['SCAN_OUTBOUND', expect.any(String), 'W-2'],
    ]);

    // Scan out box 1 at A' onto the shared route.
    await scan(b.trunkRoute.id, hanoiDockId, 'W-1').expect(201);
    await rollUp();
    const loading = await routeNow(b.trunkRoute.id);
    expect(loading.status).toBe('IN_PROGRESS');
    expect(stopStatuses(loading)).toEqual(['PROCESSING', 'PENDING']);
    expect((await shipmentNow(b.legs.leg2)).status).toBe('IN_TRANSIT');
    expect((await shipmentNow(b.root.id)).status).toBe('IN_TRANSIT');

    // Scan in box 1 at B': one item of the shared route leaves it IN_PROGRESS.
    await scan(b.trunkRoute.id, hcmcDockId, 'W-1').expect(201);
    await rollUp();
    const oneIn = await routeNow(b.trunkRoute.id);
    expect(oneIn.status).toBe('IN_PROGRESS');
    expect(stopStatuses(oneIn)).toEqual(['PROCESSING', 'PROCESSING']);

    // Mark box 2 missing at A': its open scan-out closes and an EXCEPTION task is written.
    const missing = (
      await post('/dock-tasks/missing', managerToken, {
        routeId: b.trunkRoute.id,
        locationId: hanoiDockId,
        itemId: b.box2,
        note: 'Not found on the dock',
      }).expect(201)
    ).body as DockActionResponse;
    expect(missing.completedTasks.map((task) => task.type)).toEqual([
      'SCAN_OUTBOUND',
      'EXCEPTION',
    ]);
    expect(missing.completedTasks[1]).toMatchObject({
      errorCode: 'MISSING',
      errorMessage: 'Not found on the dock',
      outboundLegId: b.legs.leg2,
    });
    expect(missing.pendingTasks).toEqual([]);
    const missingMessage = lastMessage();
    expect(missingMessage.type).toBe('MISSING');
    await rollup.apply(missingMessage);

    const finished = await routeNow(b.trunkRoute.id);
    expect(stopStatuses(finished)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(finished.status).toBe('COMPLETED');
    expect((await itemNow(b.box2)).status).toBe('EXCEPTION');
    expect((await itemNow(b.box1)).status).toBe('AT_DOCK');
    const root = await shipmentNow(b.root.id);
    expect(root.status).toBe('EXCEPTION');
    expect(root.deliveryInfos.map((point) => point.status)).toEqual([
      'COMPLETED', // store A
      'COMPLETED', // dock A'
      'COMPLETED', // dock B'
      'PENDING', // store B
    ]);
    const leg2 = await shipmentNow(b.legs.leg2);
    expect(leg2.status).toBe('AT_DOCK');
    expect(leg2.deliveryInfos.map((point) => point.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(leg2.deliveryInfos[1].actualWindow.to).toEqual(
      finished.stops[1].actualWindow.to,
    );

    // The same message again creates no task and moves nothing backwards.
    const before = {
      tasks: await dockTaskModel.countDocuments(),
      route: await routeNow(b.trunkRoute.id),
      leg: await shipmentNow(b.legs.leg2),
      root: await shipmentNow(b.root.id),
    };
    await rollup.apply(missingMessage);
    expect(await dockTaskModel.countDocuments()).toBe(before.tasks);
    expect(await routeNow(b.trunkRoute.id)).toEqual(before.route);
    expect(await shipmentNow(b.legs.leg2)).toEqual(before.leg);
    expect(await shipmentNow(b.root.id)).toEqual(before.root);
  }, 30_000);

  it('lets only a SYS_ADMIN or a DOCK_OPERATOR scan', async () => {
    const b = await book('R');
    await http()
      .post('/dock-tasks/scan')
      .field('routeId', b.pickupRoute.id)
      .expect(401);
    const response = await scan(
      b.pickupRoute.id,
      hanoiDockId,
      'R-1',
      adminToken,
    ).expect(403);
    expect((response.body as { message: string }).message).toBe(
      'Requires one of the roles: SYS_ADMIN, DOCK_OPERATOR',
    );
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('answers 404 for a barcode without a PENDING scan task there', async () => {
    const b = await book('N');
    // Not picked up yet, so nothing waits for a scan-in at the dock.
    await scan(b.pickupRoute.id, hanoiDockId, 'N-1').expect(404);
    await scan(b.pickupRoute.id, hanoiDockId, 'UNKNOWN').expect(404);
    expect(await dockTaskModel.countDocuments()).toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('answers 409 when delivery is confirmed before the items were scanned out', async () => {
    const b = await book('D');
    await post('/dock-tasks/pickup', managerToken, {
      routeId: b.pickupRoute.id,
    }).expect(201);
    publisher.publish.mockClear();

    const response = await post('/dock-tasks/delivery', managerToken, {
      routeId: b.dropoffRoute.id,
    }).expect(409);
    expect((response.body as { message: string }).message).toContain(
      'must be IN_TRANSIT on this leg',
    );
    expect(
      await dockTaskModel.countDocuments({ routeId: b.dropoffRoute.id }),
    ).toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
