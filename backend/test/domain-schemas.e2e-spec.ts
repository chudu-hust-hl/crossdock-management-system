import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model } from 'mongoose';
import { DeliveryPointType } from '../src/common/enums/delivery-point-type.enum';
import { generateUlid, isValidUlid } from '../src/common/utils/ulid.util';
import { DockTasksModule } from '../src/modules/dock-tasks/dock-tasks.module';
import { DockTaskType } from '../src/modules/dock-tasks/enums/dock-task-type.enum';
import { DockTask } from '../src/modules/dock-tasks/schemas/dock-task.schema';
import { ItemsModule } from '../src/modules/items/items.module';
import { Item } from '../src/modules/items/schemas/item.schema';
import { LocationsModule } from '../src/modules/locations/locations.module';
import { Location } from '../src/modules/locations/schemas/location.schema';
import { RoutesModule } from '../src/modules/routes/routes.module';
import { Route } from '../src/modules/routes/schemas/route.schema';
import { Shipment } from '../src/modules/shipments/schemas/shipment.schema';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { UsersModule } from '../src/modules/users/users.module';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. It uses its own database,
// which is emptied before the run and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_schemas';

type IndexSummary = { key: Record<string, number>; unique: boolean };

describe('Domain schemas (integration)', () => {
  let moduleRef: TestingModule;
  let connection: Connection;
  let locationModel: Model<Location>;
  let userModel: Model<User>;
  let itemModel: Model<Item>;
  let shipmentModel: Model<Shipment>;
  let routeModel: Model<Route>;
  let dockTaskModel: Model<DockTask>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ...testDatabaseImports(TEST_DB_NAME),
        LocationsModule,
        UsersModule,
        ItemsModule,
        ShipmentsModule,
        RoutesModule,
        DockTasksModule,
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    locationModel = moduleRef.get(getModelToken(Location.name));
    userModel = moduleRef.get(getModelToken(User.name));
    itemModel = moduleRef.get(getModelToken(Item.name));
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    routeModel = moduleRef.get(getModelToken(Route.name));
    dockTaskModel = moduleRef.get(getModelToken(DockTask.name));

    for (const model of allModels()) {
      await model.init();
      await model.deleteMany({});
    }
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await moduleRef.close();
  });

  function allModels(): Model<any>[] {
    return [
      locationModel,
      userModel,
      itemModel,
      shipmentModel,
      routeModel,
      dockTaskModel,
    ];
  }

  async function indexesOf(model: Model<any>): Promise<IndexSummary[]> {
    const indexes = await model.collection.indexes();
    return indexes
      .filter((index) => index.name !== '_id_')
      .map((index) => ({
        key: index.key as Record<string, number>,
        unique: index.unique === true,
      }));
  }

  function shipmentInput(code: string) {
    return {
      code,
      customerName: 'Cong ty TNHH ABC',
      cost: 47500,
      deliveryInfos: [
        {
          sequence: 1,
          locationId: generateUlid(),
          type: DeliveryPointType.PICKUP,
          appointment: { from: new Date('2026-10-20T01:00:00Z') },
        },
        {
          sequence: 2,
          locationId: generateUlid(),
          type: DeliveryPointType.DROPOFF,
        },
      ],
    };
  }

  function dockTaskInput(taskNumber: string) {
    return {
      taskNumber,
      itemId: generateUlid(),
      shipmentId: generateUlid(),
      routeId: generateUlid(),
      locationId: generateUlid(),
      type: DockTaskType.SCAN_INBOUND,
    };
  }

  it('registers every model through its feature module on the expected collection', () => {
    expect(connection.db?.databaseName).toBe(TEST_DB_NAME);
    expect(
      allModels().map((model) => [
        model.modelName,
        model.collection.collectionName,
      ]),
    ).toEqual([
      ['Location', 'locations'],
      ['User', 'users'],
      ['Item', 'items'],
      ['Shipment', 'shipments'],
      ['Route', 'routes'],
      ['DockTask', 'dock_tasks'],
    ]);
  });

  it.each<[string, () => Model<any>, IndexSummary[]]>([
    [
      'users',
      () => userModel,
      [
        { key: { id: 1 }, unique: true },
        { key: { email: 1 }, unique: true },
      ],
    ],
    [
      'items',
      () => itemModel,
      [
        { key: { id: 1 }, unique: true },
        { key: { itemCode: 1 }, unique: true },
        { key: { barcode: 1 }, unique: true },
        { key: { currentLocationId: 1, status: 1 }, unique: false },
      ],
    ],
    [
      'shipments',
      () => shipmentModel,
      [
        { key: { id: 1 }, unique: true },
        { key: { code: 1 }, unique: true },
        { key: { parentId: 1 }, unique: false },
        { key: { itemIds: 1 }, unique: false },
        { key: { status: 1, updatedAt: -1 }, unique: false },
      ],
    ],
    [
      'routes',
      () => routeModel,
      [
        { key: { id: 1 }, unique: true },
        { key: { routeNumber: 1 }, unique: true },
        { key: { shipmentIds: 1 }, unique: false },
        { key: { status: 1, 'appointment.from': 1 }, unique: false },
        {
          key: { fromLocationId: 1, toLocationId: 1, serviceDate: 1, slot: 1 },
          unique: true,
        },
      ],
    ],
    [
      'dock_tasks',
      () => dockTaskModel,
      [
        { key: { id: 1 }, unique: true },
        { key: { taskNumber: 1 }, unique: true },
        { key: { itemId: 1, createdAt: -1 }, unique: false },
        { key: { routeId: 1, locationId: 1, status: 1 }, unique: false },
        { key: { shipmentId: 1, type: 1, status: 1 }, unique: false },
      ],
    ],
  ])(
    'creates the declared indexes on %s in MongoDB',
    async (_collection, getModel, expected) => {
      const indexes = await indexesOf(getModel());

      expect(indexes).toEqual(expect.arrayContaining(expected));
      expect(indexes).toHaveLength(expected.length);
    },
  );

  it('normalizes email so that case variants violate the unique index', async () => {
    const user = await userModel.create({
      fullName: 'Tran Thi B',
      email: ' Manager@Example.com ',
    });

    expect(user.email).toBe('manager@example.com');
    await expect(
      userModel.create({ fullName: 'Duplicate', email: 'MANAGER@example.com' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('does not return passwordHash unless it is explicitly selected', async () => {
    const user = await userModel.create({
      fullName: 'Le Van C',
      email: 'staff.c@example.com',
      passwordHash: 'hash-placeholder',
    });

    const defaultQuery = await userModel
      .findOne({ id: user.get('id') })
      .lean()
      .exec();
    const explicitQuery = await userModel
      .findOne({ id: user.get('id') })
      .select('+passwordHash')
      .lean()
      .exec();

    expect(defaultQuery?.passwordHash).toBeUndefined();
    expect(explicitQuery?.passwordHash).toBe('hash-placeholder');
  });

  it.each<[string, () => Model<any>, object, object]>([
    [
      'Item.itemCode',
      () => itemModel,
      { itemCode: 'T-0100-1026', barcode: 'B-1', itemUnit: 'BOX' },
      { itemCode: 'T-0100-1026', barcode: 'B-2', itemUnit: 'BOX' },
    ],
    [
      'Item.barcode',
      () => itemModel,
      { itemCode: 'T-0101-1026', barcode: 'DUP-BARCODE', itemUnit: 'BOX' },
      { itemCode: 'T-0102-1026', barcode: 'DUP-BARCODE', itemUnit: 'BOX' },
    ],
    [
      'Shipment.code',
      () => shipmentModel,
      { code: 'S-0100-1026', customerName: 'A', cost: 0 },
      { code: 'S-0100-1026', customerName: 'B', cost: 0 },
    ],
    [
      'Route.routeNumber',
      () => routeModel,
      {
        routeNumber: 'R-0100-1026',
        createdBy: generateUlid(),
        fromLocationId: generateUlid(),
        toLocationId: generateUlid(),
        driverName: 'Nguyen Van Tai',
        vehiclePlate: '29A-000.01',
      },
      {
        routeNumber: 'R-0100-1026',
        createdBy: generateUlid(),
        fromLocationId: generateUlid(),
        toLocationId: generateUlid(),
        driverName: 'Nguyen Van Tai',
        vehiclePlate: '29A-000.01',
      },
    ],
    [
      'DockTask.taskNumber',
      () => dockTaskModel,
      dockTaskInput('0100-1026'),
      dockTaskInput('0100-1026'),
    ],
  ])(
    'rejects a duplicate %s with a MongoDB duplicate-key error',
    async (_field, getModel, first, second) => {
      await getModel().create(first);

      await expect(getModel().create(second)).rejects.toMatchObject({
        code: 11000,
      });
    },
  );

  it('persists shipment defaults, time windows as Dates, and timestamps', async () => {
    const created = await shipmentModel.create(shipmentInput('S-0001-1026'));
    const stored = await shipmentModel
      .findOne({ id: created.get('id') })
      .lean()
      .exec();

    expect(stored).toMatchObject({
      parentId: null,
      itemIds: [],
      status: 'CREATED',
    });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    expect(stored!.deliveryInfos.map((info) => info.sequence)).toEqual([1, 2]);
    expect(isValidUlid(stored!.deliveryInfos[0].locationId)).toBe(true);
    expect(stored!.deliveryInfos[0].appointment.from).toBeInstanceOf(Date);
    expect(stored!.deliveryInfos[1]).toMatchObject({
      status: 'PENDING',
      appointment: { from: null, to: null },
      actualWindow: { from: null, to: null },
    });
  });

  it('lets a root shipment and its segment reference the same Item document', async () => {
    const item = await itemModel.create({
      itemCode: 'T-0001-1026',
      barcode: 'BC-JOURNEY',
      itemUnit: 'BOX',
    });
    const root = await shipmentModel.create({
      ...shipmentInput('S-0002-1026'),
      itemIds: [item.get('id')],
    });
    const segment = await shipmentModel.create({
      ...shipmentInput('S-0003-1026'),
      parentId: root.get('id'),
      itemIds: [item.get('id')],
    });

    const segments = await shipmentModel
      .find({ parentId: root.get('id') })
      .exec();
    const carrying = await shipmentModel
      .find({ itemIds: item.get('id') })
      .exec();

    expect(segments.map((s) => s.code)).toEqual([segment.code]);
    expect(carrying.map((s) => s.code).sort()).toEqual([
      'S-0002-1026',
      'S-0003-1026',
    ]);
    expect(await itemModel.countDocuments({ itemCode: 'T-0001-1026' })).toBe(1);
  });

  it('keeps soft-deleted documents and their unique codes', async () => {
    const item = await itemModel.create({
      itemCode: 'T-0200-1026',
      barcode: 'BC-SOFT-DELETE',
      itemUnit: 'BOX',
    });

    item.deletedAt = new Date();
    await item.save();

    expect(
      await itemModel.countDocuments({
        itemCode: 'T-0200-1026',
        deletedAt: null,
      }),
    ).toBe(0);
    expect(await itemModel.countDocuments({ itemCode: 'T-0200-1026' })).toBe(1);
    await expect(
      itemModel.create({
        itemCode: 'T-0200-1026',
        barcode: 'BC-REUSE',
        itemUnit: 'BOX',
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('stores references as ULID strings that resolve through the unique id index', async () => {
    const location = await locationModel.create({
      name: 'Hanoi Cross-Dock',
      type: 'CROSS_DOCK',
      address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
    });
    const shipment = await shipmentModel.create({
      code: 'S-0300-1026',
      customerName: 'Cong ty TNHH ABC',
      cost: 0,
      deliveryInfos: [
        {
          sequence: 1,
          locationId: location.get('id'),
          type: DeliveryPointType.TRANSIT,
        },
      ],
    });

    const raw = await shipmentModel.collection.findOne({
      id: shipment.get('id'),
    });
    const { locationId } = (raw as unknown as Shipment).deliveryInfos[0];
    const resolved = await locationModel.findOne({ id: locationId }).exec();

    expect(typeof locationId).toBe('string');
    expect(resolved?.name).toBe('Hanoi Cross-Dock');
  });

  it('rejects an ObjectId where a ULID reference is expected', async () => {
    await expect(
      dockTaskModel.create({
        ...dockTaskInput('0002-1026'),
        itemId: '507f1f77bcf86cd799439011',
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('does not check that referenced documents exist (a service-layer responsibility)', async () => {
    const task = await dockTaskModel.create(dockTaskInput('0001-1026'));

    expect(await itemModel.exists({ id: task.itemId })).toBeNull();
    expect(task.status).toBe('PENDING');
  });
});
