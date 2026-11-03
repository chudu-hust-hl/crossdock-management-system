import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { isValidUlid } from '../src/common/utils/ulid.util';
import { LocationType } from '../src/modules/locations/enums/location-type.enum';
import { LocationsModule } from '../src/modules/locations/locations.module';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. It uses its own database,
// which is emptied before the run and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_locations';

describe('Location schema (integration)', () => {
  let moduleRef: TestingModule;
  let connection: Connection;
  let locationModel: Model<Location>;

  function locationInput(name: string) {
    return {
      name: ` ${name} `,
      type: LocationType.CROSS_DOCK,
      address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
    };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), LocationsModule],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    locationModel = moduleRef.get<Model<Location>>(
      getModelToken(Location.name),
    );

    await locationModel.init();
    await locationModel.deleteMany({});
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await moduleRef.close();
  });

  it('registers the Location model on the locations collection', () => {
    expect(connection.db?.databaseName).toBe(TEST_DB_NAME);
    expect(locationModel.modelName).toBe('Location');
    expect(locationModel.collection.collectionName).toBe('locations');
  });

  it('creates unique indexes on id and on the store identity in MongoDB', async () => {
    const uniqueIndexes = (await locationModel.collection.indexes()).filter(
      (index) => index.unique,
    );

    expect(uniqueIndexes.map((index) => index.key)).toEqual([
      { id: 1 },
      { name: 1, contactName: 1, 'address.postalCode': 1 },
    ]);
    expect(uniqueIndexes[1]).toMatchObject({
      name: 'store_identity',
      collation: { locale: 'vi', strength: 2 },
      partialFilterExpression: { type: 'STORE', deletedAt: null },
    });
  });

  it('persists generated id, default status, trimmed values, and timestamps', async () => {
    const created = await locationModel.create(locationInput('Hanoi Hub'));
    const stored = await locationModel
      .findOne({ id: created.get('id') })
      .lean()
      .exec();

    expect(stored).not.toBeNull();
    expect(stored!._id).toBeInstanceOf(Types.ObjectId);
    expect(isValidUlid(stored!.id)).toBe(true);
    expect(stored!.status).toBe('ACTIVE');
    expect(stored!.name).toBe('Hanoi Hub');
    expect(stored!.deletedAt).toBeNull();
    expect(stored!.createdAt).toBeInstanceOf(Date);
    expect(stored!.updatedAt).toBeInstanceOf(Date);
  });

  it('updates updatedAt but not createdAt when a location changes', async () => {
    const location = await locationModel.create(locationInput('Da Nang Hub'));
    const { createdAt, updatedAt } = location;

    await new Promise((resolve) => setTimeout(resolve, 10));
    location.name = 'Renamed Hub';
    await location.save();

    expect(location.createdAt).toEqual(createdAt);
    expect(location.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
  });

  it('rejects a duplicate id with a MongoDB duplicate-key error', async () => {
    const first = await locationModel.create(locationInput('First Hub'));

    await expect(
      locationModel.create({
        ...locationInput('Second Hub'),
        id: first.get('id'),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
