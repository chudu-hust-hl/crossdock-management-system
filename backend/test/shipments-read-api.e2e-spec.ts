import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { Item } from '../src/modules/items/schemas/item.schema';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { Metadata } from '../src/modules/metadata/schemas/metadata.schema';
import {
  ShipmentPageResponse,
  ShipmentResponse,
} from '../src/modules/shipments/dto/shipment-response.dto';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_shipments_read_api';

// Test rates for the booking used in the detail test; they take precedence over backend/.env.
process.env.PRICING_BASE_FEE = '20000';
process.env.PRICING_FEE_PER_ITEM = '5000';
process.env.PRICING_FEE_PER_KG = '3000';

// References are ULIDs; the Locations and Items do not need to exist for listing.
const STORE_A = generateUlid();
const STORE_B = generateUlid();
const CROSS_DOCK = generateUlid();
const ITEM_1 = generateUlid();
const ITEM_2 = generateUlid();
const ITEM_3 = generateUlid();

function stops(...locationIds: string[]) {
  return locationIds.map((locationId, index) => ({
    sequence: index + 1,
    locationId,
    type:
      index === 0
        ? 'PICKUP'
        : index === locationIds.length - 1
          ? 'DROPOFF'
          : 'TRANSIT',
  }));
}

describe('Shipments read API (integration)', () => {
  let app: INestApplication<App>;
  let shipmentModel: Model<Shipment>;
  let models: Model<unknown>[];
  let rootId: string;
  let deletedId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), ShipmentsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    models = [Shipment, Location, Item, Metadata].map((model) =>
      moduleRef.get<Model<unknown>>(getModelToken(model.name)),
    );
    await Promise.all(models.map((model) => model.init()));
  });

  /** Creates a Shipment with a fixed `createdAt`, so that sorting by it is predictable. */
  async function seed(
    fields: Record<string, unknown>,
    createdAt: string,
  ): Promise<string> {
    const shipment = await shipmentModel.create(fields);
    await shipmentModel.collection.updateOne(
      { id: shipment.id },
      { $set: { createdAt: new Date(createdAt) } },
    );
    return shipment.id;
  }

  // Two bookings (roots), two legs of the first booking, and one deleted booking.
  beforeEach(async () => {
    await Promise.all(models.map((model) => model.deleteMany({})));
    rootId = await seed(
      {
        code: 'S-0001-1026',
        customerName: 'Cong ty TNHH ABC',
        cost: 40500,
        itemIds: [ITEM_1, ITEM_2],
        deliveryInfos: stops(STORE_A, STORE_B),
      },
      '2026-10-01T00:00:00Z',
    );
    await seed(
      {
        code: 'S-0002-1026',
        customerName: 'Cong ty XYZ',
        cost: 25000,
        status: 'IN_TRANSIT',
        itemIds: [ITEM_3],
        deliveryInfos: stops(STORE_A, CROSS_DOCK, STORE_B),
      },
      '2026-10-02T00:00:00Z',
    );
    await seed(
      {
        code: 'S-0003-1026',
        parentId: rootId,
        status: 'IN_TRANSIT',
        itemIds: [ITEM_1, ITEM_2],
        deliveryInfos: stops(STORE_A, CROSS_DOCK),
      },
      '2026-10-03T00:00:00Z',
    );
    await seed(
      {
        code: 'S-0004-1026',
        parentId: rootId,
        itemIds: [ITEM_1, ITEM_2],
        deliveryInfos: stops(CROSS_DOCK, STORE_B),
      },
      '2026-10-04T00:00:00Z',
    );
    deletedId = await seed(
      {
        code: 'S-0005-1026',
        customerName: 'Cong ty ABC (deleted)',
        cost: 30000,
        itemIds: [ITEM_1],
        deliveryInfos: stops(STORE_A, STORE_B),
        deletedAt: new Date(),
      },
      '2026-10-05T00:00:00Z',
    );
  });

  afterAll(async () => {
    await shipmentModel.db.dropDatabase();
    await app.close();
  });

  function get(path: string) {
    return request(app.getHttpServer()).get(path);
  }

  async function list(query: string) {
    const response = await get(`/shipments${query}`).expect(200);
    return response.body as ShipmentPageResponse;
  }

  const codes = (page: ShipmentPageResponse) =>
    page.items.map((shipment) => shipment.code);

  describe('GET /shipments', () => {
    it('returns the first page of non-deleted shipments, newest first', async () => {
      const page = await list('');

      expect(page).toMatchObject({ page: 1, limit: 20, total: 4 });
      expect(codes(page)).toEqual([
        'S-0004-1026',
        'S-0003-1026',
        'S-0002-1026',
        'S-0001-1026',
      ]);
      expect(page.items[0]).not.toHaveProperty('_id');
      expect(page.items[0]).not.toHaveProperty('deletedAt');
    });

    it.each([
      ['?status=IN_TRANSIT', ['S-0003-1026', 'S-0002-1026']],
      ['?code=s-0001', ['S-0001-1026']],
      ['?customerName=abc', ['S-0001-1026']],
      ['?isRoot=true', ['S-0002-1026', 'S-0001-1026']],
      ['?isRoot=false', ['S-0004-1026', 'S-0003-1026']],
      [`?itemId=${ITEM_1}`, ['S-0004-1026', 'S-0003-1026', 'S-0001-1026']],
      [
        `?locationId=${CROSS_DOCK}`,
        ['S-0004-1026', 'S-0003-1026', 'S-0002-1026'],
      ],
      [`?locationId=${STORE_A}&isRoot=true`, ['S-0002-1026', 'S-0001-1026']],
      ['?status=CREATED&isRoot=false', ['S-0004-1026']],
    ])('filters with %s', async (query, expected) => {
      const page = await list(query);

      expect(codes(page)).toEqual(expected);
      expect(page.total).toBe(expected.length);
    });

    it('lists the legs of one booking by its ULID', async () => {
      const page = await list(`?parentId=${rootId}&sortBy=code&sortOrder=asc`);

      expect(codes(page)).toEqual(['S-0003-1026', 'S-0004-1026']);
      expect(page.items.every((leg) => leg.parentId === rootId)).toBe(true);
    });

    it('pages through the results and reports the total on every page', async () => {
      const first = await list('?limit=3');
      const second = await list('?limit=3&page=2');

      expect(first).toMatchObject({ page: 1, limit: 3, total: 4 });
      expect(codes(first)).toHaveLength(3);
      expect(second).toMatchObject({ page: 2, limit: 3, total: 4 });
      expect(codes(second)).toEqual(['S-0001-1026']);
    });

    it('sorts by the requested field and order', async () => {
      expect(codes(await list('?sortBy=code&sortOrder=asc'))).toEqual([
        'S-0001-1026',
        'S-0002-1026',
        'S-0003-1026',
        'S-0004-1026',
      ]);
      expect(codes(await list('?isRoot=true&sortBy=cost'))).toEqual([
        'S-0001-1026',
        'S-0002-1026',
      ]);
      expect(
        codes(await list('?isRoot=true&sortBy=cost&sortOrder=asc')),
      ).toEqual(['S-0002-1026', 'S-0001-1026']);
    });

    it.each([
      ['no shipment matches', '?customerName=nobody', 0],
      ['an unknown parent ULID is given', `?parentId=${generateUlid()}`, 0],
      ['only a deleted shipment matches', '?code=S-0005', 0],
      ['the page is past the last one', '?page=5', 4],
    ])('returns an empty page when %s', async (_case, query, total) => {
      const page = await list(query);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(total);
    });

    it.each([
      [
        'an ObjectId as itemId',
        `?itemId=${new Types.ObjectId().toString()}`,
        'itemId must be a ULID',
      ],
      [
        'an unknown status',
        '?status=LOST',
        'status must be one of the following values: CREATED, IN_TRANSIT, AT_DOCK, DELIVERED, CANCELLED, EXCEPTION',
      ],
      ['a non-boolean isRoot', '?isRoot=yes', 'isRoot must be a boolean value'],
      ['limit 0', '?limit=0', 'limit must not be less than 1'],
      [
        'an unknown parameter',
        '?origin=Hanoi',
        'property origin should not exist',
      ],
    ])('rejects %s with 400', async (_case, query, message) => {
      const response = await get(`/shipments${query}`).expect(400);

      expect((response.body as { message: string[] }).message).toContain(
        message,
      );
    });

    it('rejects parentId together with isRoot=true', async () => {
      const response = await get(
        `/shipments?isRoot=true&parentId=${rootId}`,
      ).expect(400);

      expect((response.body as { message: string }).message).toBe(
        'parentId cannot be combined with isRoot=true: a root shipment has no parent',
      );
    });
  });

  describe('GET /shipments/:id', () => {
    it('returns a shipment by its ULID, with ULID references only', async () => {
      const response = await get(`/shipments/${rootId}`).expect(200);
      const shipment = response.body as ShipmentResponse;

      expect(shipment).toMatchObject({
        id: rootId,
        code: 'S-0001-1026',
        parentId: null,
        customerName: 'Cong ty TNHH ABC',
        cost: 40500,
        itemIds: [ITEM_1, ITEM_2],
        status: 'CREATED',
      });
      expect(shipment.deliveryInfos.map((info) => info.locationId)).toEqual([
        STORE_A,
        STORE_B,
      ]);
      expect(shipment).not.toHaveProperty('_id');
    });

    it('returns a booked shipment exactly as the booking returned it', async () => {
      const booked = await request(app.getHttpServer())
        .post('/shipments/book')
        .send({
          customerName: 'Cong ty Booking',
          pickup: {
            location: {
              name: 'Store A',
              contactName: 'Nguyen Van A',
              address: { addressLine1: '1 Street', postalCode: '100000' },
            },
            appointment: {
              from: '2026-10-27T08:00:00+07:00',
              to: '2026-10-27T10:00:00+07:00',
            },
          },
          dropoff: {
            location: {
              name: 'Store B',
              contactName: 'Tran Thi B',
              address: { addressLine1: '2 Street', postalCode: '700000' },
            },
            appointment: {
              from: '2026-10-29T13:00:00+07:00',
              to: '2026-10-29T17:00:00+07:00',
            },
          },
          items: [
            { barcode: 'BC-1', itemUnit: 'BAG', weight: 1, weightUnit: 'KG' },
          ],
        })
        .expect(201);
      const { id } = booked.body as ShipmentResponse;

      const response = await get(`/shipments/${id}`).expect(200);

      expect(response.body).toEqual(booked.body);
    });

    it('returns 404 for an unknown or soft-deleted shipment', async () => {
      const unknown = await get(`/shipments/${generateUlid()}`).expect(404);
      await get(`/shipments/${deletedId}`).expect(404);

      expect((unknown.body as { message: string }).message).toMatch(
        /^Shipment [0-9A-Z]{26} not found$/,
      );
    });

    it('returns 400 for an id that is not a ULID, e.g. a MongoDB ObjectId', async () => {
      const response = await get(
        `/shipments/${new Types.ObjectId().toString()}`,
      ).expect(400);

      expect((response.body as { message: string[] }).message).toEqual([
        'id must be a ULID',
      ]);
    });
  });
});
