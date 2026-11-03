import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { businessCodePeriod } from '../src/common/utils/business-code.util';
import { generateUlid, isValidUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { ItemsService } from '../src/modules/items/items.service';
import { Item } from '../src/modules/items/schemas/item.schema';
import { LocationStatus } from '../src/modules/locations/enums/location-status.enum';
import { LocationType } from '../src/modules/locations/enums/location-type.enum';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { Metadata } from '../src/modules/metadata/schemas/metadata.schema';
import { ShipmentResponse } from '../src/modules/shipments/dto/shipment-response.dto';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_shipments_api';

// Test rates; variables set here take precedence over backend/.env.
process.env.PRICING_BASE_FEE = '20000';
process.env.PRICING_FEE_PER_ITEM = '5000';
process.env.PRICING_FEE_PER_KG = '3000';

function candidate(name: string, contactName: string, postalCode: string) {
  return {
    name,
    contactName,
    contactPhone: '0901234567',
    address: { addressLine1: `1 ${name} Street`, postalCode },
  };
}

function newItem(barcode: string, overrides: Record<string, unknown> = {}) {
  return {
    barcode,
    itemUnit: 'BOX',
    weight: 2.5,
    weightUnit: 'KG',
    ...overrides,
  };
}

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    customerName: 'Cong ty TNHH ABC',
    pickup: {
      location: candidate('Store A', 'Nguyen Van A', '100000'),
      appointment: {
        from: '2026-10-27T08:00:00+07:00',
        to: '2026-10-27T10:00:00+07:00',
      },
    },
    dropoff: {
      location: candidate('Store B', 'Tran Thi B', '700000'),
      appointment: {
        from: '2026-10-29T13:00:00+07:00',
        to: '2026-10-29T17:00:00+07:00',
      },
    },
    items: [
      newItem('BC-0001', {
        description: 'Carton of books',
        dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
      }),
      newItem('BC-0002', { itemUnit: 'PALLET', weight: 1 }),
    ],
    ...overrides,
  };
}

function code(prefix: 'S' | 'T', counter: number): string {
  return `${prefix}-${String(counter).padStart(4, '0')}-${businessCodePeriod(new Date())}`;
}

describe('Shipments API (integration)', () => {
  let app: INestApplication<App>;
  let shipmentModel: Model<Shipment>;
  let locationModel: Model<Location>;
  let itemModel: Model<Item>;
  let metadataModel: Model<Metadata>;
  let itemsService: ItemsService;
  let configService: ConfigService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), ShipmentsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    locationModel = moduleRef.get(getModelToken(Location.name));
    itemModel = moduleRef.get(getModelToken(Item.name));
    metadataModel = moduleRef.get(getModelToken(Metadata.name));
    itemsService = moduleRef.get(ItemsService);
    configService = moduleRef.get(ConfigService);
    await Promise.all(
      [shipmentModel, locationModel, itemModel, metadataModel].map((model) =>
        model.init(),
      ),
    );
  });

  beforeEach(async () => {
    await Promise.all([
      shipmentModel.deleteMany({}),
      locationModel.deleteMany({}),
      itemModel.deleteMany({}),
      metadataModel.deleteMany({}),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await shipmentModel.db.dropDatabase();
    await app.close();
  });

  function post(body: object) {
    return request(app.getHttpServer()).post('/shipments/book').send(body);
  }

  async function counts() {
    return {
      shipments: await shipmentModel.countDocuments(),
      items: await itemModel.countDocuments(),
      locations: await locationModel.countDocuments(),
    };
  }

  function findItem(id: string) {
    return itemModel.findOne({ id }).lean<Item>();
  }

  function findStore(name: string) {
    return locationModel.findOne({ name }).lean<Location>();
  }

  let existingItemCounter = 0;

  /** An Item that already exists (e.g. from an earlier booking) with this barcode. */
  async function registeredItem(barcode: string): Promise<void> {
    existingItemCounter += 1;
    await itemModel.create({
      itemCode: `T-${9000 + existingItemCounter}-1026`,
      barcode,
      itemUnit: 'BOX',
    });
  }

  describe('successful booking', () => {
    it('books a root shipment with customer, cost, code, and PICKUP/DROPOFF delivery infos', async () => {
      const response = await post(bookingBody()).expect(201);
      const body = response.body as Record<string, unknown>;
      const shipment = response.body as ShipmentResponse;

      const pickup = await findStore('Store A');
      const dropoff = await findStore('Store B');
      expect(isValidUlid(shipment.id)).toBe(true);
      expect(shipment).toMatchObject({
        code: code('S', 1),
        customerName: 'Cong ty TNHH ABC',
        // 20000 + 5000 × 2 items + 3000 × (2.5 + 1) kg
        cost: 40500,
        parentId: null,
        status: 'CREATED',
      });
      expect(shipment.deliveryInfos).toEqual([
        {
          sequence: 1,
          locationId: pickup!.id,
          type: 'PICKUP',
          appointment: {
            from: '2026-10-27T01:00:00.000Z',
            to: '2026-10-27T03:00:00.000Z',
          },
          actualWindow: { from: null, to: null },
          status: 'PENDING',
        },
        {
          sequence: 2,
          locationId: dropoff!.id,
          type: 'DROPOFF',
          appointment: {
            from: '2026-10-29T06:00:00.000Z',
            to: '2026-10-29T10:00:00.000Z',
          },
          actualWindow: { from: null, to: null },
          status: 'PENDING',
        },
      ]);
      expect(body).not.toHaveProperty('_id');
      expect(body).not.toHaveProperty('__v');
      expect(body).not.toHaveProperty('deletedAt');
    });

    it('creates one Item per supplied item, at the pickup Location and assigned to the shipment', async () => {
      const response = await post(bookingBody()).expect(201);
      const shipment = response.body as ShipmentResponse;

      const pickup = await findStore('Store A');
      expect(shipment.itemIds).toHaveLength(2);
      const items = await Promise.all(shipment.itemIds.map(findItem));
      expect(items[0]).toMatchObject({
        itemCode: code('T', 1),
        barcode: 'BC-0001',
        itemUnit: 'BOX',
        description: 'Carton of books',
        weight: 2.5,
        weightUnit: 'KG',
        dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
        status: 'CREATED',
        currentLocationId: pickup!.id,
        currentShipmentId: shipment.id,
        deletedAt: null,
      });
      expect(items[1]).toMatchObject({
        itemCode: code('T', 2),
        barcode: 'BC-0002',
        itemUnit: 'PALLET',
        currentLocationId: pickup!.id,
        currentShipmentId: shipment.id,
      });
      expect(await itemModel.countDocuments()).toBe(2);
    });

    it('stores only ULID references', async () => {
      const response = await post(bookingBody()).expect(201);
      const { id } = response.body as ShipmentResponse;

      const stored = await shipmentModel.findOne({ id }).lean<Shipment>();
      const references = [
        ...stored!.itemIds,
        ...stored!.deliveryInfos.map((info) => info.locationId),
      ];
      expect(references).toHaveLength(4);
      expect(references.every(isValidUlid)).toBe(true);
    });

    it('converts pound weights for the cost', async () => {
      const response = await post(
        bookingBody({
          items: [newItem('BC-LB', { weight: 10, weightUnit: 'LB' })],
        }),
      ).expect(201);

      // 20000 + 5000 + 3000 × 4.5359237 kg, rounded
      expect((response.body as ShipmentResponse).cost).toBe(38608);
    });

    it('creates new Items for every booking, never reusing earlier ones', async () => {
      const first = await post(bookingBody()).expect(201);
      const second = await post(
        bookingBody({
          items: [newItem('BC-0003'), newItem('BC-0004', { itemUnit: 'KEG' })],
        }),
      ).expect(201);

      const firstIds = (first.body as ShipmentResponse).itemIds;
      const secondIds = (second.body as ShipmentResponse).itemIds;
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
      expect(await itemModel.countDocuments()).toBe(4);
      for (const id of firstIds) {
        expect(await findItem(id)).toMatchObject({
          currentShipmentId: (first.body as ShipmentResponse).id,
        });
      }
    });

    it('gives concurrent bookings distinct codes and creates each store once', async () => {
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          post(
            bookingBody({
              items: [newItem(`BC-${n}-A`), newItem(`BC-${n}-B`)],
            }),
          ),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      const shipments = responses.map(
        (response) => response.body as ShipmentResponse,
      );
      expect(shipments.map((s) => s.code).sort()).toEqual(
        [1, 2, 3, 4, 5].map((n) => code('S', n)),
      );
      const items = await itemModel.find().lean<Item[]>();
      expect(new Set(items.map((item) => item.itemCode)).size).toBe(10);
      expect(await locationModel.countDocuments()).toBe(2);
    });
  });

  describe('endpoint Location resolution', () => {
    it('reuses a matching store despite case and whitespace, without overwriting it', async () => {
      const existing = await locationModel.create({
        ...candidate('Store A', 'Nguyen Van A', '100000'),
        type: LocationType.STORE,
        contactPhone: '0900000000',
      });

      const body = bookingBody();
      body.pickup.location = {
        ...candidate('  store   a ', 'NGUYEN VAN A', ' 100000 '),
        contactPhone: '0999999999',
        address: { addressLine1: 'A different street', postalCode: '100000' },
      };
      const response = await post(body).expect(201);

      const shipment = response.body as ShipmentResponse;
      expect(shipment.deliveryInfos[0].locationId).toBe(existing.toObject().id);
      expect(await findStore('Store A')).toMatchObject({
        contactPhone: '0900000000',
        address: { addressLine1: '1 Store A Street', postalCode: '100000' },
      });
      expect(await locationModel.countDocuments()).toBe(2);
    });

    it('creates a new store when only two of the three identity fields match', async () => {
      await post(bookingBody()).expect(201);

      const body = bookingBody({ items: [newItem('BC-OTHER')] });
      body.pickup.location = candidate('Store A', 'Nguyen Van A', '100001');
      const response = await post(body).expect(201);

      const original = await locationModel
        .findOne({ 'address.postalCode': '100000' })
        .lean<Location>();
      expect(
        (response.body as ShipmentResponse).deliveryInfos[0].locationId,
      ).not.toBe(original!.id);
      expect(await locationModel.countDocuments()).toBe(3);
    });

    it('does not reuse a CROSS_DOCK or a soft-deleted store with the same details', async () => {
      const dock = await locationModel.create({
        ...candidate('Store A', 'Nguyen Van A', '100000'),
        type: LocationType.CROSS_DOCK,
      });
      const deleted = await locationModel.create({
        ...candidate('Store B', 'Tran Thi B', '700000'),
        type: LocationType.STORE,
        deletedAt: new Date(),
      });

      const response = await post(bookingBody()).expect(201);

      const [pickup, dropoff] = (response.body as ShipmentResponse)
        .deliveryInfos;
      expect(pickup.locationId).not.toBe(dock.toObject().id);
      expect(dropoff.locationId).not.toBe(deleted.toObject().id);
    });
  });

  describe('business rule rejections (nothing is booked)', () => {
    it('rejects a barcode that is already registered: an Item is never booked twice', async () => {
      await registeredItem('BC-0002');

      const response = await post(bookingBody()).expect(409);

      expect((response.body as { message: string }).message).toBe(
        'Barcodes already registered: BC-0002',
      );
      expect(await counts()).toEqual({ shipments: 0, items: 1, locations: 0 });
    });

    it('rejects a pickup and drop-off that resolve to the same Location, and removes that new store', async () => {
      const body = bookingBody();
      body.dropoff.location = candidate(' STORE A', 'nguyen van a', '100000');

      const response = await post(body).expect(400);

      expect((response.body as { message: string }).message).toMatch(
        /^pickup and dropoff are the same Location \(\w{26}\)$/,
      );
      expect(await counts()).toEqual({ shipments: 0, items: 0, locations: 0 });
      expect(await metadataModel.countDocuments()).toBe(0);
    });

    it('rejects an INACTIVE store and keeps it, but removes the new pickup store', async () => {
      const inactive = await locationModel.create({
        ...candidate('Store B', 'Tran Thi B', '700000'),
        type: LocationType.STORE,
        status: LocationStatus.INACTIVE,
      });

      const response = await post(bookingBody()).expect(400);

      expect((response.body as { message: string }).message).toBe(
        `dropoff Location ${inactive.toObject().id} is INACTIVE`,
      );
      expect(await counts()).toEqual({ shipments: 0, items: 0, locations: 1 });
    });

    it('answers 503 without writing anything when pricing is not configured', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(null);

      await post(bookingBody()).expect(503);

      expect(await counts()).toEqual({ shipments: 0, items: 0, locations: 0 });
    });
  });

  describe('invalid payloads', () => {
    const valid = bookingBody();

    it.each<[string, Record<string, unknown>, string]>([
      [
        'a missing customer name',
        { customerName: undefined },
        'customerName should not be empty',
      ],
      [
        'a missing appointment',
        { pickup: { location: valid.pickup.location } },
        'pickup.appointment must be an object',
      ],
      [
        'an appointment that ends before it starts',
        {
          pickup: {
            location: valid.pickup.location,
            appointment: {
              from: '2026-10-27T10:00:00Z',
              to: '2026-10-27T08:00:00Z',
            },
          },
        },
        'pickup.appointment.to must not be earlier than from',
      ],
      [
        'a candidate without contactName',
        {
          pickup: {
            ...valid.pickup,
            location: {
              name: 'Store A',
              address: { addressLine1: '1 Street', postalCode: '100000' },
            },
          },
        },
        'pickup.location.contactName should not be empty',
      ],
      ['no items', { items: [] }, 'items must contain at least 1 elements'],
      [
        'an item without a weight',
        { items: [{ barcode: 'BC-1', itemUnit: 'BOX', weightUnit: 'KG' }] },
        'items.0.weight must be a positive number',
      ],
      [
        'an unknown item unit',
        { items: [newItem('BC-1', { itemUnit: 'CRATE' })] },
        'items.0.itemUnit must be one of the following values: BOX, PALLET, KEG, BAG',
      ],
      [
        'two items with the same barcode',
        { items: [newItem('BC-1'), newItem('BC-1')] },
        'Each item in items must have a different barcode',
      ],
      [
        'a client-supplied item code',
        { items: [newItem('BC-1', { itemCode: 'T-0001-1026' })] },
        'items.0.property itemCode should not exist',
      ],
      [
        'references to existing items',
        { itemIds: [generateUlid()] },
        'property itemIds should not exist',
      ],
      ['a client-supplied cost', { cost: 1 }, 'property cost should not exist'],
      [
        'a client-supplied code',
        { code: 'S-0001-1026' },
        'property code should not exist',
      ],
      [
        'client-supplied delivery infos',
        { deliveryInfos: [] },
        'property deliveryInfos should not exist',
      ],
    ])('rejects %s with 400', async (_case, overrides, message) => {
      const response = await post(bookingBody(overrides)).expect(400);

      expect((response.body as { message: string[] }).message).toContain(
        message,
      );
      expect(await counts()).toEqual({ shipments: 0, items: 0, locations: 0 });
    });
  });

  describe('failure of a later step (rollback)', () => {
    it('removes the created items and the new store, but keeps a reused store, when saving the shipment fails', async () => {
      const reusedDropoff = await locationModel.create({
        ...candidate('Store B', 'Tran Thi B', '700000'),
        type: LocationType.STORE,
      });
      jest
        .spyOn(shipmentModel, 'create')
        .mockRejectedValueOnce(new Error('simulated write failure'));

      await post(bookingBody()).expect(500);

      expect(await counts()).toEqual({ shipments: 0, items: 0, locations: 1 });
      expect(await findStore('Store B')).toMatchObject({
        id: reusedDropoff.toObject().id,
      });
    });

    it('frees the barcodes of a failed booking, so it can be retried', async () => {
      jest
        .spyOn(shipmentModel, 'create')
        .mockRejectedValueOnce(new Error('simulated write failure'));
      await post(bookingBody()).expect(500);

      const retry = await post(bookingBody()).expect(201);

      expect((retry.body as ShipmentResponse).itemIds).toHaveLength(2);
    });

    it('removes items inserted before a concurrent barcode conflict and answers 409', async () => {
      // Another request registers BC-0002 between the check and the insert.
      jest.spyOn(itemsService, 'findUsedBarcodes').mockResolvedValueOnce([]);
      await registeredItem('BC-0002');

      const response = await post(bookingBody()).expect(409);

      expect((response.body as { message: string }).message).toContain(
        'taken by another request at the same time',
      );
      expect(await itemModel.find().lean<Item[]>()).toEqual([
        expect.objectContaining({ barcode: 'BC-0002' }),
      ]);
      expect(await counts()).toEqual({ shipments: 0, items: 1, locations: 0 });
    });

    it('keeps a new store that another shipment started using in the meantime', async () => {
      jest.spyOn(shipmentModel, 'create').mockImplementationOnce(async () => {
        const pickup = await findStore('Store A');
        await shipmentModel.collection.insertOne({
          id: generateUlid(),
          code: 'S-9999-1026',
          deliveryInfos: [{ sequence: 1, locationId: pickup!.id }],
        });
        throw new Error('simulated write failure');
      });

      await post(bookingBody()).expect(500);

      expect(await findStore('Store A')).not.toBeNull();
      expect(await findStore('Store B')).toBeNull();
      expect(await itemModel.countDocuments()).toBe(0);
    });

    it('does not reuse codes: a failed booking leaves a gap, never a duplicate', async () => {
      jest
        .spyOn(shipmentModel, 'create')
        .mockRejectedValueOnce(new Error('simulated write failure'));
      await post(bookingBody()).expect(500);

      const response = await post(bookingBody()).expect(201);

      expect((response.body as ShipmentResponse).code).toBe(code('S', 2));
    });
  });
});
