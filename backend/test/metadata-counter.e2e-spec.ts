import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { BusinessCodeType } from '../src/common/enums/business-code-type.enum';
import { MetadataScope } from '../src/modules/metadata/enums/metadata-scope.enum';
import { MetadataModule } from '../src/modules/metadata/metadata.module';
import { MetadataService } from '../src/modules/metadata/metadata.service';
import { Metadata } from '../src/modules/metadata/schemas/metadata.schema';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_metadata';

const OCTOBER = new Date('2026-10-15T12:00:00Z');
const NOVEMBER = new Date('2026-11-15T12:00:00Z');

describe('MetadataService business-code counters (integration)', () => {
  let moduleRef: TestingModule;
  let metadataModel: Model<Metadata>;
  let metadataService: MetadataService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), MetadataModule],
    }).compile();
    metadataModel = moduleRef.get(getModelToken(Metadata.name));
    metadataService = moduleRef.get(MetadataService);
    await metadataModel.init();
  });

  beforeEach(async () => {
    await metadataModel.deleteMany({});
  });

  afterAll(async () => {
    await metadataModel.db.dropDatabase();
    await moduleRef.close();
  });

  it('starts at 0001 and counts up within a month', async () => {
    const codes = [
      await metadataService.nextBusinessCode(
        BusinessCodeType.SHIPMENT,
        OCTOBER,
      ),
      await metadataService.nextBusinessCode(
        BusinessCodeType.SHIPMENT,
        OCTOBER,
      ),
    ];

    expect(codes).toEqual(['S-0001-1026', 'S-0002-1026']);
  });

  it('stores one counter entry per type and month', async () => {
    await metadataService.nextBusinessCode(BusinessCodeType.SHIPMENT, OCTOBER);
    await metadataService.nextBusinessCode(BusinessCodeType.SHIPMENT, OCTOBER);

    const entries = await metadataModel.find().lean<Metadata[]>();
    expect(entries).toEqual([
      expect.objectContaining({
        scope: MetadataScope.BUSINESS_CODE_COUNTER,
        key: 'SHIPMENT-1026',
        value: 2,
        deletedAt: null,
      }),
    ]);
  });

  it('restarts every month and keeps a separate counter per code type', async () => {
    await metadataService.nextBusinessCode(BusinessCodeType.SHIPMENT, OCTOBER);
    await metadataService.nextBusinessCode(BusinessCodeType.SHIPMENT, OCTOBER);

    expect(
      await metadataService.nextBusinessCode(
        BusinessCodeType.SHIPMENT,
        NOVEMBER,
      ),
    ).toBe('S-0001-1126');
    expect(
      await metadataService.nextBusinessCode(BusinessCodeType.ITEM, OCTOBER),
    ).toBe('T-0001-1026');
    expect(
      await metadataService.nextBusinessCode(
        BusinessCodeType.SHIPMENT,
        OCTOBER,
      ),
    ).toBe('S-0003-1026');
  });

  it('reserves several consecutive codes with one increment', async () => {
    await metadataService.nextBusinessCode(BusinessCodeType.ITEM, OCTOBER);

    expect(
      await metadataService.nextBusinessCodes(
        BusinessCodeType.ITEM,
        OCTOBER,
        3,
      ),
    ).toEqual(['T-0002-1026', 'T-0003-1026', 'T-0004-1026']);
    expect(
      await metadataService.nextBusinessCodes(
        BusinessCodeType.ITEM,
        OCTOBER,
        0,
      ),
    ).toEqual([]);
    expect(
      await metadataService.nextBusinessCode(BusinessCodeType.ITEM, OCTOBER),
    ).toBe('T-0005-1026');
  });

  it('gives concurrent callers distinct, consecutive codes', async () => {
    const codes = await Promise.all(
      Array.from({ length: 10 }, () =>
        metadataService.nextBusinessCode(BusinessCodeType.SHIPMENT, OCTOBER),
      ),
    );

    expect([...codes].sort()).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `S-${String(i + 1).padStart(4, '0')}-1026`,
      ),
    );
    expect(await metadataModel.countDocuments()).toBe(1);
  });
});
