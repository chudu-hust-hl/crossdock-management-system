import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { Item } from '../src/modules/items/schemas/item.schema';
import { LocationType } from '../src/modules/locations/enums/location-type.enum';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { Metadata } from '../src/modules/metadata/schemas/metadata.schema';
import { Route } from '../src/modules/routes/schemas/route.schema';
import * as trunkSlot from '../src/modules/routes/trunk-slot';
import { Province } from '../src/modules/routing/schemas/province.schema';
import { ShipmentResponse } from '../src/modules/shipments/dto/shipment-response.dto';
import { ShipmentPageResponse } from '../src/modules/shipments/dto/shipment-summary-response.dto';
import { ShipmentViewResponse } from '../src/modules/shipments/dto/shipment-view-response.dto';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { bearer, tokenFor } from './utils/test-auth';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_shipment_edits_api';

// cost = 20000 + 5000 × items + 3000 × kg; these take precedence over backend/.env.
process.env.PRICING_BASE_FEE = '20000';
process.env.PRICING_FEE_PER_ITEM = '5000';
process.env.PRICING_FEE_PER_KG = '3000';

const PICKUP = {
  from: '2026-11-10T01:00:00.000Z',
  to: '2026-11-10T03:00:00.000Z',
};
const DROPOFF = {
  from: '2026-11-12T06:00:00.000Z',
  to: '2026-11-12T10:00:00.000Z',
};
/** The morning dock–dock window of 2026-11-07 (08:00–12:00 Vietnam time). */
const TRUNK_WINDOW = {
  from: new Date('2026-11-07T01:00:00.000Z'),
  to: new Date('2026-11-07T05:00:00.000Z'),
};

function store(name: string, postalCode: string, province: string) {
  return {
    name,
    contactName: `${name} Contact`,
    address: { addressLine1: `1 ${name} Street`, postalCode, province },
  };
}

/**
 * A routed booking goes Store A (Hanoi) → Store B (Ho Chi Minh City). An unrouted one
 * uses two other stores whose province matches nothing, so routing stops.
 */
function booking(barcodePrefix: string, routed: boolean) {
  const [pickupStore, dropoffStore] = routed
    ? [
        store('Store A', '100000', 'Hanoi'),
        store('Store B', '700000', 'Ho Chi Minh City'),
      ]
    : [
        store('Store C', '100001', 'Nowhere'),
        store('Store D', '700001', 'Nowhere'),
      ];
  return {
    customerName: 'Cong ty TNHH ABC',
    pickup: { location: pickupStore, appointment: PICKUP },
    dropoff: { location: dropoffStore, appointment: DROPOFF },
    items: [
      {
        barcode: `${barcodePrefix}-1`,
        itemUnit: 'BOX',
        description: 'Carton of books',
        weight: 2.5,
        weightUnit: 'KG',
      },
      {
        barcode: `${barcodePrefix}-2`,
        itemUnit: 'PALLET',
        weight: 1,
        weightUnit: 'KG',
      },
    ],
  };
}

describe('Shipment summary, view and edits API (integration)', () => {
  let app: INestApplication<App>;
  let shipmentModel: Model<Shipment>;
  let locationModel: Model<Location>;
  let itemModel: Model<Item>;
  let routeModel: Model<Route>;
  let provinceModel: Model<Province>;
  let models: Model<unknown>[];
  let hanoiDockId: string;
  let hcmcDockId: string;
  let moduleRef: TestingModule;
  let adminToken: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ...testDatabaseImports(TEST_DB_NAME),
        AuthModule,
        ShipmentsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    locationModel = moduleRef.get(getModelToken(Location.name));
    itemModel = moduleRef.get(getModelToken(Item.name));
    routeModel = moduleRef.get(getModelToken(Route.name));
    provinceModel = moduleRef.get(getModelToken(Province.name));
    models = [Shipment, Location, Item, Metadata, Province, Route].map(
      (model) => moduleRef.get<Model<unknown>>(getModelToken(model.name)),
    );
    await Promise.all(models.map((model) => model.init()));
    adminToken = await tokenFor(moduleRef, UserRole.ADMIN);
  });

  beforeEach(async () => {
    await Promise.all(models.map((model) => model.deleteMany({})));
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
  });

  const http = () => request(app.getHttpServer());
  /** The booking writes need an ADMIN (or SYS_ADMIN) token. */
  const asAdmin = () => ({
    post: (url: string) =>
      http().post(url).set('Authorization', bearer(adminToken)),
    put: (url: string) =>
      http().put(url).set('Authorization', bearer(adminToken)),
  });

  async function book(
    barcodePrefix: string,
    routed = true,
  ): Promise<ShipmentResponse> {
    const response = await asAdmin()
      .post('/shipments/book')
      .send(booking(barcodePrefix, routed))
      .expect(201);
    return response.body as ShipmentResponse;
  }

  async function view(id: string): Promise<ShipmentViewResponse> {
    return (await http().get(`/shipments/${id}/view`).expect(200))
      .body as ShipmentViewResponse;
  }

  async function routesOf(viewBody: ShipmentViewResponse) {
    const [storeToHub, hubToHub, hubToStore] = viewBody.children;
    const routes = await routeModel.find().lean<Route[]>();
    const carrying = (childId: string) =>
      routes.find((route) => route.shipmentIds.includes(childId))!;
    return {
      pickupRoute: carrying(storeToHub.id),
      trunkRoute: carrying(hubToHub.id),
      dropoffRoute: carrying(hubToStore.id),
    };
  }

  const setStatus = (id: string, status: string) =>
    shipmentModel.updateOne({ id }, { $set: { status } });

  describe('GET /shipments (summaries)', () => {
    it('describes each booking by its stores, appointments and items', async () => {
      const routed = await book('R');
      const page = (await http().get('/shipments?isRoot=true').expect(200))
        .body as ShipmentPageResponse;

      expect(page.total).toBe(1);
      expect(page.items[0]).toEqual({
        id: routed.id,
        code: routed.code,
        status: 'CREATED',
        customerName: 'Cong ty TNHH ABC',
        cost: 40500,
        createdAt: routed.createdAt,
        origin: {
          id: routed.deliveryInfos[0].locationId,
          name: 'Store A',
          type: 'STORE',
          province: 'Hanoi',
        },
        destination: {
          id: routed.deliveryInfos[3].locationId,
          name: 'Store B',
          type: 'STORE',
          province: 'Ho Chi Minh City',
        },
        pickupAppointment: PICKUP,
        dropoffAppointment: DROPOFF,
        items: [
          expect.objectContaining({
            id: routed.itemIds[0],
            itemUnit: 'BOX',
            weight: 2.5,
            weightUnit: 'KG',
          }),
          expect.objectContaining({
            id: routed.itemIds[1],
            itemUnit: 'PALLET',
          }),
        ],
        routed: true,
      });
      expect(page.items[0]).not.toHaveProperty('deliveryInfos');
    });

    it('reads the Locations and Items of a whole page in one query each', async () => {
      await book('R');
      await book('U', false);
      const locationFind = jest.spyOn(locationModel, 'find');
      const itemFind = jest.spyOn(itemModel, 'find');

      const page = (await http().get('/shipments?isRoot=true').expect(200))
        .body as ShipmentPageResponse;

      expect(page.items.map((row) => row.routed)).toEqual([false, true]);
      expect(page.items.every((row) => row.items.length === 2)).toBe(true);
      expect(locationFind).toHaveBeenCalledTimes(1);
      expect(itemFind).toHaveBeenCalledTimes(1);
    });

    it('keeps a missing Location as its id with a null name', async () => {
      const routed = await book('R');
      await locationModel.updateOne(
        { id: routed.deliveryInfos[0].locationId },
        { $set: { deletedAt: new Date() } },
      );

      const page = (await http().get('/shipments?isRoot=true').expect(200))
        .body as ShipmentPageResponse;

      expect(page.items[0].origin).toEqual({
        id: routed.deliveryInfos[0].locationId,
        name: null,
        type: null,
        province: null,
      });
      expect(page.items[0].destination?.name).toBe('Store B');
    });
  });

  describe('GET /shipments/:id/view', () => {
    it('assembles the booking with its Locations, Items, legs and routes', async () => {
      const routed = await book('R');

      const body = await view(routed.id);

      expect(body.shipment).toEqual(routed);
      expect(body.children.map((child) => child.id)).toEqual(
        routed.childrenIds,
      );
      expect(body.children.map((child) => child.parentId)).toEqual([
        routed.id,
        routed.id,
        routed.id,
      ]);
      expect(body.items.map((item) => item.id)).toEqual(routed.itemIds);
      expect(body.items[0]).toMatchObject({
        barcode: 'R-1',
        description: 'Carton of books',
        itemUnit: 'BOX',
        status: 'CREATED',
        currentLocationId: routed.deliveryInfos[0].locationId,
        currentShipmentId: routed.id,
      });
      expect(body.locations.map((location) => location.id).sort()).toEqual(
        routed.deliveryInfos.map((info) => info.locationId).sort(),
      );
      expect(body.locations[0]).toHaveProperty('address');
      expect(body.routes).toHaveLength(3);
      expect(body.routes.filter((route) => route.slot)).toEqual([
        expect.objectContaining({
          slot: 'MORNING',
          serviceDate: '2026-11-07',
          fromLocationId: hanoiDockId,
          toLocationId: hcmcDockId,
        }),
      ]);
      expect(Object.keys(body.routes[0].items[0]).sort()).toEqual([
        'barcode',
        'itemCode',
        'itemId',
        'shipmentId',
      ]);
    });

    it('returns empty children and routes for a booking routing could not route', async () => {
      const direct = await book('U', false);

      const body = await view(direct.id);

      expect(body.children).toEqual([]);
      expect(body.routes).toEqual([]);
      expect(body.locations).toHaveLength(2);
    });

    it('answers a child id or an unknown id with 404, and a non-ULID with 400', async () => {
      const routed = await book('R');

      await http().get(`/shipments/${routed.childrenIds[0]}/view`).expect(404);
      await http().get(`/shipments/${generateUlid()}/view`).expect(404);
      const invalid = await http()
        .get(`/shipments/${new Types.ObjectId().toString()}/view`)
        .expect(400);
      expect((invalid.body as { message: string[] }).message).toEqual([
        'id must be a ULID',
      ]);
    });
  });

  describe('PUT /shipments/:id', () => {
    it("changes only the booking's customer name", async () => {
      const routed = await book('R');

      const response = await asAdmin()
        .put(`/shipments/${routed.id}`)
        .send({ customerName: '  Cong ty XYZ ' })
        .expect(200);

      expect(response.body).toMatchObject({
        id: routed.id,
        customerName: 'Cong ty XYZ',
        cost: routed.cost,
        deliveryInfos: routed.deliveryInfos,
      });
    });

    it('rejects a blank name, a child id, and a booking that is not CREATED', async () => {
      const routed = await book('R');

      await asAdmin()
        .put(`/shipments/${routed.id}`)
        .send({ customerName: ' ' })
        .expect(400);
      await asAdmin()
        .put(`/shipments/${routed.childrenIds[0]}`)
        .send({ customerName: 'X' })
        .expect(404);

      await setStatus(routed.id, 'IN_TRANSIT');
      const conflict = await asAdmin()
        .put(`/shipments/${routed.id}`)
        .send({ customerName: 'X' })
        .expect(409);
      expect((conflict.body as { message: string }).message).toBe(
        `Booking ${routed.code} is IN_TRANSIT; the booking can no longer be edited`,
      );
    });

    it('needs a token of a SYS_ADMIN or ADMIN: 401 without one, 403 for a dock role', async () => {
      const routed = await book('R');
      const operatorToken = await tokenFor(moduleRef, UserRole.DOCK_OPERATOR);
      const sysAdminToken = await tokenFor(moduleRef, UserRole.SYS_ADMIN);

      await http()
        .put(`/shipments/${routed.id}`)
        .send({ customerName: 'X' })
        .expect(401);
      const forbidden = await http()
        .put(`/shipments/${routed.id}`)
        .set('Authorization', bearer(operatorToken))
        .send({ customerName: 'X' })
        .expect(403);
      expect((forbidden.body as { message: string }).message).toBe(
        'Requires one of the roles: SYS_ADMIN, ADMIN',
      );
      await http()
        .put(`/shipments/${routed.id}`)
        .set('Authorization', bearer(sysAdminToken))
        .send({ customerName: 'Cong ty SYS' })
        .expect(200);

      expect((await view(routed.id)).shipment.customerName).toBe('Cong ty SYS');
    });
  });

  describe('PUT /shipments/:id/appointments', () => {
    const pickup = {
      from: '2026-11-11T01:00:00.000Z',
      to: '2026-11-11T02:30:00.000Z',
    };
    const dropoff = {
      from: '2026-11-13T07:00:00.000Z',
      to: '2026-11-13T09:00:00.000Z',
    };

    it('writes the windows to the root, the store legs and their dedicated routes', async () => {
      const routed = await book('R');
      const before = await routesOf(await view(routed.id));

      const response = await asAdmin()
        .put(`/shipments/${routed.id}/appointments`)
        .send({ pickup, dropoff })
        .expect(200);
      const body = response.body as ShipmentViewResponse;

      expect(body.shipment.deliveryInfos.map((i) => i.appointment)).toEqual([
        pickup,
        { from: null, to: null },
        { from: null, to: null },
        dropoff,
      ]);
      const [storeToHub, hubToHub, hubToStore] = body.children;
      expect(storeToHub.deliveryInfos.map((i) => i.appointment)).toEqual([
        pickup,
        { from: null, to: null },
      ]);
      expect(hubToHub.deliveryInfos.map((i) => i.appointment)).toEqual([
        { from: null, to: null },
        { from: null, to: null },
      ]);
      expect(hubToStore.deliveryInfos.map((i) => i.appointment)).toEqual([
        { from: null, to: null },
        dropoff,
      ]);

      const after = await routesOf(body);
      const asDates = (w: { from: string; to: string }) => ({
        from: new Date(w.from),
        to: new Date(w.to),
      });
      expect(after.pickupRoute.appointment).toEqual(asDates(pickup));
      expect(after.pickupRoute.stops.map((s) => s.appointment)).toEqual([
        asDates(pickup),
        before.pickupRoute.stops[1].appointment,
      ]);
      expect(after.dropoffRoute.appointment).toEqual(asDates(dropoff));
      expect(after.dropoffRoute.stops[1].appointment).toEqual(asDates(dropoff));
      for (const route of [after.pickupRoute, after.dropoffRoute]) {
        expect(route.actualWindow).toEqual({ from: null, to: null });
        expect(route.stops.map((s) => s.status)).toEqual([
          'PENDING',
          'PENDING',
        ]);
      }
    });

    it('leaves a dock–dock route with its slot, day and window', async () => {
      const routed = await book('R');
      const { trunkRoute: before } = await routesOf(await view(routed.id));

      const body = (
        await asAdmin()
          .put(`/shipments/${routed.id}/appointments`)
          .send({ pickup, dropoff })
          .expect(200)
      ).body as ShipmentViewResponse;
      const { trunkRoute: after } = await routesOf(body);

      expect(after.appointment).toEqual(TRUNK_WINDOW);
      expect(after).toMatchObject({
        slot: 'MORNING',
        serviceDate: '2026-11-07',
        appointment: before.appointment,
        stops: before.stops,
        updatedAt: before.updatedAt,
      });
    });

    it('updates only the two root points of a booking that was not routed', async () => {
      const direct = await book('U', false);

      const body = (
        await asAdmin()
          .put(`/shipments/${direct.id}/appointments`)
          .send({ pickup, dropoff })
          .expect(200)
      ).body as ShipmentViewResponse;

      expect(body.shipment.deliveryInfos.map((i) => i.appointment)).toEqual([
        pickup,
        dropoff,
      ]);
      expect(await shipmentModel.countDocuments()).toBe(1);
    });

    it.each([
      [
        'an empty pickup window',
        { pickup: { from: pickup.from, to: pickup.from }, dropoff },
        ['pickup.from must be before pickup.to'],
      ],
      [
        'a pickup that ends after the drop-off starts',
        { pickup: { from: pickup.from, to: dropoff.to }, dropoff },
        ['pickup.to must not be later than dropoff.from'],
      ],
      ['a missing drop-off', { pickup }, ['dropoff must be an object']],
    ])('rejects %s with 400', async (_case, body, message) => {
      const routed = await book('R');

      const response = await asAdmin()
        .put(`/shipments/${routed.id}/appointments`)
        .send(body)
        .expect(400);

      expect((response.body as { message: string[] }).message).toEqual(
        expect.arrayContaining(message),
      );
      expect((await view(routed.id)).shipment).toEqual(routed);
    });

    it('answers 409 when the booking is not CREATED, and changes nothing', async () => {
      const routed = await book('R');
      await setStatus(routed.id, 'CANCELLED');

      await asAdmin()
        .put(`/shipments/${routed.id}/appointments`)
        .send({ pickup, dropoff })
        .expect(409);

      const root = await shipmentModel.findOne({ id: routed.id }).lean();
      expect(root!.deliveryInfos[0].appointment.from).toEqual(
        new Date(PICKUP.from),
      );
    });
  });

  describe('PUT /shipments/:id/items/:itemId', () => {
    it('saves the item, recalculates the cost and rewrites the route snapshots', async () => {
      const routed = await book('R');
      const itemId = routed.itemIds[1];

      const response = await asAdmin()
        .put(`/shipments/${routed.id}/items/${itemId}`)
        .send({
          description: 'Pallet of paper',
          weight: 11,
          weightUnit: 'KG',
          dimensions: { length: 120, width: 100, height: 90, unit: 'CM' },
        })
        .expect(200);
      const body = response.body as ShipmentViewResponse;

      // 20000 + 5000 × 2 + 3000 × (2.5 + 11) = 70500
      expect(body.shipment.cost).toBe(70500);
      expect(body.items[1]).toMatchObject({
        id: itemId,
        barcode: 'R-2',
        description: 'Pallet of paper',
        itemUnit: 'PALLET',
        weight: 11,
        weightUnit: 'KG',
        dimensions: { length: 120, width: 100, height: 90, unit: 'CM' },
      });

      const routes = await routeModel.find().lean<Route[]>();
      const rows = routes.flatMap((route) =>
        route.items.filter((row) => row.itemId === itemId),
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).toMatchObject({
          itemCode: body.items[1].itemCode,
          barcode: 'R-2',
          description: 'Pallet of paper',
          itemUnit: 'PALLET',
          weight: 11,
          weightUnit: 'KG',
        });
      }
      const untouched = routes.flatMap((route) =>
        route.items.filter((row) => row.itemId !== itemId),
      );
      expect(untouched.every((row) => row.weight === 2.5)).toBe(true);
    });

    it('removes the description from the item and its snapshot rows with null', async () => {
      const routed = await book('R');
      const itemId = routed.itemIds[0];

      const body = (
        await asAdmin()
          .put(`/shipments/${routed.id}/items/${itemId}`)
          .send({ description: null, itemUnit: 'BAG' })
          .expect(200)
      ).body as ShipmentViewResponse;

      expect(body.items[0]).not.toHaveProperty('description');
      expect(body.items[0]).toMatchObject({ itemUnit: 'BAG', weight: 2.5 });
      expect(body.shipment.cost).toBe(routed.cost);
      const rows = (await routeModel.find().lean<Route[]>()).flatMap((r) =>
        r.items.filter((row) => row.itemId === itemId),
      );
      expect(rows.map((row) => [row.itemUnit, row.description])).toEqual([
        ['BAG', undefined],
        ['BAG', undefined],
        ['BAG', undefined],
      ]);
    });

    it('answers 404 for an item of another booking', async () => {
      const routed = await book('R');
      const other = await book('O', false);

      const response = await asAdmin()
        .put(`/shipments/${routed.id}/items/${other.itemIds[0]}`)
        .send({ weight: 5, weightUnit: 'KG' })
        .expect(404);

      expect((response.body as { message: string }).message).toBe(
        `Item ${other.itemIds[0]} is not on booking ${routed.code}`,
      );
      const item = await itemModel.findOne({ id: other.itemIds[0] }).lean();
      expect(item!.weight).toBe(2.5);
    });

    it.each([
      ['a barcode', { barcode: 'NEW' }, 'property barcode should not exist'],
      [
        'a weight without its unit',
        { weight: 5 },
        'weightUnit must be one of the following values: KG, LB',
      ],
    ])('rejects %s with 400', async (_case, body, message) => {
      const routed = await book('R');

      const response = await asAdmin()
        .put(`/shipments/${routed.id}/items/${routed.itemIds[0]}`)
        .send(body)
        .expect(400);

      expect((response.body as { message: string[] }).message).toEqual([
        message,
      ]);
    });

    it('answers 409 when the booking is not CREATED, and leaves the item', async () => {
      const routed = await book('R');
      await setStatus(routed.id, 'AT_DOCK');

      await asAdmin()
        .put(`/shipments/${routed.id}/items/${routed.itemIds[0]}`)
        .send({ weight: 9, weightUnit: 'KG' })
        .expect(409);

      const item = await itemModel.findOne({ id: routed.itemIds[0] }).lean();
      expect(item!.weight).toBe(2.5);
    });
  });
});
