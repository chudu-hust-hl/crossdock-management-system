import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateUlid, isValidUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import {
  LocationPageResponse,
  LocationResponse,
} from '../src/modules/locations/dto/location-response.dto';
import { LocationsModule } from '../src/modules/locations/locations.module';
import { LocationsService } from '../src/modules/locations/locations.service';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before the run and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_locations_api';

function store(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    type: 'STORE',
    contactName: 'Nguyen Van A',
    contactPhone: '0901234567',
    address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
    ...overrides,
  };
}

function crossDock(name: string) {
  return {
    name,
    type: 'CROSS_DOCK',
    address: { addressLine1: 'KCN Thang Long', postalCode: '155000' },
  };
}

describe('Locations API (integration)', () => {
  let app: INestApplication<App>;
  let locationModel: Model<Location>;
  let locationsService: LocationsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), LocationsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    locationModel = moduleRef.get(getModelToken(Location.name));
    locationsService = moduleRef.get(LocationsService);
    await locationModel.init();
    await locationModel.deleteMany({});
  });

  afterAll(async () => {
    await locationModel.db.dropDatabase();
    await app.close();
  });

  function post(body: object) {
    return request(app.getHttpServer()).post('/locations').send(body);
  }

  describe('POST /locations', () => {
    it('creates a cross-dock and returns its public ULID, without internal fields', async () => {
      const response = await post(crossDock('Hanoi Cross-Dock')).expect(201);
      const body = response.body as Record<string, unknown>;

      expect(isValidUlid(body.id as string)).toBe(true);
      expect(body).toMatchObject({
        name: 'Hanoi Cross-Dock',
        type: 'CROSS_DOCK',
        status: 'ACTIVE',
        address: { addressLine1: 'KCN Thang Long', postalCode: '155000' },
      });
      expect(body).not.toHaveProperty('_id');
      expect(body).not.toHaveProperty('__v');
      expect(body).not.toHaveProperty('deletedAt');
    });

    it.each(['WAREHOUSE', 'CUSTOMER'])(
      'creates a %s location',
      async (type) => {
        const response = await post({
          ...crossDock(`Generic ${type}`),
          type,
        }).expect(201);

        expect((response.body as LocationResponse).type).toBe(type);
      },
    );

    it('does not deduplicate cross-docks: each request creates a new one', async () => {
      const first = await post(crossDock('Da Nang Cross-Dock')).expect(201);
      const second = await post(crossDock('Da Nang Cross-Dock')).expect(201);

      expect((second.body as LocationResponse).id).not.toBe(
        (first.body as LocationResponse).id,
      );
    });

    it('creates a store and reuses it when the normalized identity matches', async () => {
      const created = await post(store('Store Reuse')).expect(201);
      const reused = await post(
        store('  STORE   reuse ', {
          contactName: 'nguyen  VAN a',
          contactPhone: '0999999999',
          address: { addressLine1: '99 Other Street', postalCode: ' 100000 ' },
        }),
      ).expect(200);

      const original = created.body as LocationResponse;
      expect(reused.body).toEqual(original);
      expect(original).toMatchObject({
        name: 'Store Reuse',
        contactName: 'Nguyen Van A',
        contactPhone: '0901234567',
        address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
      });
      expect(await locationModel.countDocuments({ id: original.id })).toBe(1);
    });

    it('stores normalized identity fields', async () => {
      const response = await post(
        store('  Store   Spaces ', {
          contactName: ' Tran   Thi B ',
          address: { addressLine1: '1 Dai Co Viet', postalCode: ' 100 000 ' },
        }),
      ).expect(201);

      expect(response.body).toMatchObject({
        name: 'Store Spaces',
        contactName: 'Tran Thi B',
        address: { postalCode: '100 000' },
      });
    });

    it.each([
      ['name', { name: 'Store Mismatch 2' }],
      ['contactName', { contactName: 'Le Van C' }],
      ['contactName diacritics', { contactName: 'Nguyễn Văn A' }],
      [
        'postalCode',
        { address: { addressLine1: '1 Dai Co Viet', postalCode: '700000' } },
      ],
    ])(
      'creates a new store when only %s differs',
      async (_field, overrides) => {
        const base = await post(store('Store Mismatch')).expect((res) => {
          expect([200, 201]).toContain(res.status);
        });
        const other = await post({
          ...store('Store Mismatch'),
          ...overrides,
        }).expect(201);

        expect((other.body as LocationResponse).id).not.toBe(
          (base.body as LocationResponse).id,
        );
      },
    );

    it('does not treat a cross-dock with the same identity values as a store match', async () => {
      const dock = await post({
        ...crossDock('Shared Identity'),
        contactName: 'Nguyen Van A',
        address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
      }).expect(201);
      const shop = await post(store('Shared Identity')).expect(201);

      expect((shop.body as LocationResponse).id).not.toBe(
        (dock.body as LocationResponse).id,
      );
    });

    it('does not reuse a soft-deleted store', async () => {
      const deleted = await post(store('Store Deleted')).expect(201);
      await locationModel.updateOne(
        { id: (deleted.body as LocationResponse).id },
        { deletedAt: new Date() },
      );

      const recreated = await post(store('Store Deleted')).expect(201);

      expect((recreated.body as LocationResponse).id).not.toBe(
        (deleted.body as LocationResponse).id,
      );
    });

    it.each([
      [
        'a store without contactName',
        { ...store('No Contact'), contactName: undefined },
        ['contactName should not be empty'],
      ],
      [
        'the removed DOCK type',
        { ...crossDock('Dock Door 1'), type: 'DOCK' },
        [
          'type must be one of the following values: WAREHOUSE, CROSS_DOCK, STORE, CUSTOMER',
        ],
      ],
      [
        'a blank name and missing postal code',
        { ...crossDock('   '), address: { addressLine1: '1 Street' } },
        ['name should not be empty', 'address.postalCode should not be empty'],
      ],
      [
        'a client-supplied id or _id',
        { ...crossDock('With Ids'), id: generateUlid(), _id: 'x' },
        ['property id should not exist', 'property _id should not exist'],
      ],
    ])('rejects %s with 400', async (_case, body, messages) => {
      const response = await post(body).expect(400);

      expect((response.body as { message: string[] }).message).toEqual(
        expect.arrayContaining(messages),
      );
    });
  });

  describe('GET /locations', () => {
    /** Creates a Location with a fixed `createdAt`, so that sorting by it is predictable. */
    async function seed(fields: Record<string, unknown>, createdAt: string) {
      const location = await locationModel.create(fields);
      await locationModel.collection.updateOne(
        { id: location.id },
        { $set: { createdAt: new Date(createdAt) } },
      );
    }

    beforeEach(async () => {
      await locationModel.deleteMany({});
      await seed(crossDock('Alpha Cross-Dock'), '2026-10-01T00:00:00Z');
      await seed(store('Beta Store'), '2026-10-02T00:00:00Z');
      await seed(
        store('Gamma Store', {
          contactName: 'Tran Thi B',
          status: 'INACTIVE',
          address: { addressLine1: '12 Le Loi', postalCode: '700000' },
        }),
        '2026-10-03T00:00:00Z',
      );
      await seed(
        {
          name: 'Kho Đà Nẵng',
          type: 'WAREHOUSE',
          address: { addressLine1: '3 Tran Phu', postalCode: '550000' },
        },
        '2026-10-04T00:00:00Z',
      );
      await seed(
        store('Deleted Store', { deletedAt: new Date() }),
        '2026-10-05T00:00:00Z',
      );
    });

    async function list(query: string) {
      const response = await request(app.getHttpServer())
        .get(`/locations${query}`)
        .expect(200);
      return response.body as LocationPageResponse;
    }

    const names = (page: LocationPageResponse) =>
      page.items.map((location) => location.name);

    it('returns the first page of non-deleted locations, sorted by name', async () => {
      const page = await list('');

      expect(page).toMatchObject({ page: 1, limit: 20, total: 4 });
      expect(names(page)).toEqual([
        'Alpha Cross-Dock',
        'Beta Store',
        'Gamma Store',
        'Kho Đà Nẵng',
      ]);
      expect(page.items[0]).not.toHaveProperty('_id');
      expect(page.items[0]).not.toHaveProperty('deletedAt');
    });

    it.each([
      ['?type=STORE', ['Beta Store', 'Gamma Store']],
      ['?status=INACTIVE', ['Gamma Store']],
      ['?type=STORE&status=ACTIVE', ['Beta Store']],
      ['?name=STORE', ['Beta Store', 'Gamma Store']],
      ['?name=%20cross-dock%20', ['Alpha Cross-Dock']],
      ['?name=đà%20nẵng', ['Kho Đà Nẵng']],
      ['?contactName=nguyen', ['Beta Store']],
      ['?postalCode=700000', ['Gamma Store']],
    ])('filters with %s', async (query, expected) => {
      const page = await list(query);

      expect(names(page)).toEqual(expected);
      expect(page.total).toBe(expected.length);
    });

    it('pages through the results and reports the total on every page', async () => {
      const first = await list('?limit=2');
      const second = await list('?limit=2&page=2');

      expect(first).toMatchObject({ page: 1, limit: 2, total: 4 });
      expect(names(first)).toEqual(['Alpha Cross-Dock', 'Beta Store']);
      expect(second).toMatchObject({ page: 2, limit: 2, total: 4 });
      expect(names(second)).toEqual(['Gamma Store', 'Kho Đà Nẵng']);
    });

    it('sorts by the requested field and order', async () => {
      expect(names(await list('?sortBy=createdAt&sortOrder=desc'))).toEqual([
        'Kho Đà Nẵng',
        'Gamma Store',
        'Beta Store',
        'Alpha Cross-Dock',
      ]);
      expect(names(await list('?sortOrder=desc&type=STORE'))).toEqual([
        'Gamma Store',
        'Beta Store',
      ]);
    });

    it.each([
      ['no location matches', '?type=CUSTOMER', 0],
      ['regex characters are matched literally', '?name=.*', 0],
      ['the page is past the last one', '?page=3&limit=2', 4],
    ])('returns an empty page when %s', async (_case, query, total) => {
      const page = await list(query);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(total);
    });

    it.each([
      [
        '?type=DOCK',
        'type must be one of the following values: WAREHOUSE, CROSS_DOCK, STORE, CUSTOMER',
      ],
      ['?limit=101', 'limit must not be greater than 100'],
      ['?page=0', 'page must not be less than 1'],
      ['?name=', 'name should not be empty'],
      [
        '?sortBy=deletedAt',
        'sortBy must be one of the following values: name, createdAt, updatedAt',
      ],
      ['?deletedAt=null', 'property deletedAt should not exist'],
    ])('rejects %s with 400', async (query, message) => {
      const response = await request(app.getHttpServer())
        .get(`/locations${query}`)
        .expect(400);

      expect((response.body as { message: string[] }).message).toContain(
        message,
      );
    });
  });

  describe('GET /locations/:id', () => {
    it('returns a location by its ULID', async () => {
      const created = await post(crossDock('Lookup Cross-Dock')).expect(201);
      const { id } = created.body as LocationResponse;

      const response = await request(app.getHttpServer())
        .get(`/locations/${id}`)
        .expect(200);

      expect(response.body).toEqual(created.body);
    });

    it('returns 404 for an unknown or soft-deleted location', async () => {
      const created = await post(crossDock('Deleted Lookup')).expect(201);
      const { id } = created.body as LocationResponse;
      await locationModel.updateOne({ id }, { deletedAt: new Date() });

      await request(app.getHttpServer()).get(`/locations/${id}`).expect(404);
      await request(app.getHttpServer())
        .get(`/locations/${generateUlid()}`)
        .expect(404);
    });

    it('returns 400 for an id that is not a ULID', async () => {
      const response = await request(app.getHttpServer())
        .get('/locations/507f1f77bcf86cd799439011')
        .expect(400);

      expect((response.body as { message: string[] }).message).toEqual([
        'id must be a ULID',
      ]);
    });
  });

  describe('LocationsService.resolveCandidate', () => {
    const candidate = {
      name: 'Candidate Store',
      contactName: 'Pham Van D',
      address: { addressLine1: '5 Le Loi', postalCode: '700000' },
    };

    it('creates a STORE when nothing matches, then reuses it', async () => {
      const first = await locationsService.resolveCandidate(candidate);
      const second = await locationsService.resolveCandidate({
        ...candidate,
        name: 'candidate  store',
        contactPhone: '0911111111',
      });

      expect(first.created).toBe(true);
      expect(first.location.type).toBe('STORE');
      expect(second.created).toBe(false);
      expect(second.location.id).toBe(first.location.id);
      expect(second.location.contactPhone).toBeUndefined();
    });

    it('reuses a store that an administrator created manually', async () => {
      const manual = await post(store('Manual Store')).expect(201);

      const resolved = await locationsService.resolveCandidate({
        name: 'Manual Store',
        contactName: 'Nguyen Van A',
        address: { addressLine1: 'anything', postalCode: '100000' },
      });

      expect(resolved.created).toBe(false);
      expect(resolved.location.id).toBe((manual.body as LocationResponse).id);
    });

    it('creates only one store when the same candidate arrives concurrently', async () => {
      const concurrent = {
        ...candidate,
        name: 'Concurrent Store',
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          locationsService.resolveCandidate(concurrent),
        ),
      );

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.location.id)).size).toBe(1);
      expect(
        await locationModel.countDocuments({ name: 'Concurrent Store' }),
      ).toBe(1);
    });
  });
});
