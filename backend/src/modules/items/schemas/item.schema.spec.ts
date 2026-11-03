import { Mongoose } from 'mongoose';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { DimensionUnit } from '../enums/dimension-unit.enum';
import { ItemStatus } from '../enums/item-status.enum';
import { ItemUnit } from '../enums/item-unit.enum';
import { WeightUnit } from '../enums/weight-unit.enum';
import { DimensionsSchema } from './dimensions.schema';
import { Item, ItemSchema } from './item.schema';

const ItemModel = new Mongoose().model<Item>(Item.name, ItemSchema);

function validItemInput() {
  return {
    itemCode: 'T-0001-1026',
    barcode: '8930000000017',
    itemUnit: ItemUnit.BOX,
  };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new ItemModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('ItemSchema', () => {
  describe('definition', () => {
    it('maps to the items collection with timestamps enabled', () => {
      expect(ItemSchema.get('collection')).toBe('items');
      expect(ItemSchema.get('timestamps')).toBe(true);
    });

    it('declares unique id, itemCode, barcode and a location/status query index', () => {
      const indexes = ItemSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique === true,
      }));

      expect(indexes).toEqual(
        expect.arrayContaining([
          { fields: { id: 1 }, unique: true },
          { fields: { itemCode: 1 }, unique: true },
          { fields: { barcode: 1 }, unique: true },
          { fields: { currentLocationId: 1, status: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });

    it('generates id with the shared ULID utility', () => {
      expect(ItemSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
      });
    });

    it('references Location and Shipment by their ULID id', () => {
      for (const field of ['currentLocationId', 'currentShipmentId']) {
        expect(ItemSchema.path(field).instance).toBe('String');
        expect(ItemSchema.path(field).options).toMatchObject({
          validate: ulidValidator,
        });
        expect(ItemSchema.path(field).options.ref).toBeUndefined();
      }
    });

    it('accepts ULID references and rejects ObjectIds', () => {
      expect(
        validationErrorPaths({
          ...validItemInput(),
          currentLocationId: generateUlid(),
          currentShipmentId: generateUlid(),
        }),
      ).toEqual([]);
      expect(
        validationErrorPaths({
          ...validItemInput(),
          currentLocationId: '507f1f77bcf86cd799439011',
          currentShipmentId: '507f1f77bcf86cd799439011',
        }),
      ).toEqual(['currentLocationId', 'currentShipmentId']);
    });

    it('embeds dimensions without an _id and stores no shipment history', () => {
      expect(DimensionsSchema.path('_id')).toBeUndefined();
      expect(ItemSchema.path('shipmentIds')).toBeUndefined();
      expect(ItemSchema.path('history')).toBeUndefined();
    });

    it('allows exactly the documented item statuses', () => {
      expect(ItemSchema.path('status').options).toMatchObject({
        enum: ['CREATED', 'IN_TRANSIT', 'AT_DOCK', 'DELIVERED', 'EXCEPTION'],
        default: ItemStatus.CREATED,
      });
    });
  });

  describe('validation', () => {
    it('accepts a minimal item and leaves measurements and references unset', () => {
      const item = new ItemModel(validItemInput());

      expect(item.validateSync()).toBeUndefined();
      expect(item.status).toBe(ItemStatus.CREATED);
      expect(item.currentLocationId).toBeUndefined();
      expect(item.weight).toBeUndefined();
      expect(item.dimensions).toBeUndefined();
    });

    it('requires itemCode, barcode, and itemUnit', () => {
      expect(validationErrorPaths({})).toEqual([
        'barcode',
        'itemCode',
        'itemUnit',
      ]);
    });

    it('allows exactly the item units BOX, PALLET, KEG, and BAG', () => {
      expect(ItemSchema.path('itemUnit').options).toMatchObject({
        enum: ['BOX', 'PALLET', 'KEG', 'BAG'],
        required: true,
      });
      expect(
        validationErrorPaths({ ...validItemInput(), itemUnit: 'CRATE' }),
      ).toEqual(['itemUnit']);
    });

    it('requires itemCode in the T-<nnnn>-MMYY format', () => {
      expect(
        validationErrorPaths({ ...validItemInput(), itemCode: 'T-35413-1026' }),
      ).toEqual([]);
      expect(
        validationErrorPaths({ ...validItemInput(), itemCode: 'S-35413-1026' }),
      ).toEqual(['itemCode']);
    });

    it('is not soft-deleted by default', () => {
      expect(new ItemModel(validItemInput()).deletedAt).toBeNull();
    });

    it('requires weightUnit only when weight is set', () => {
      expect(
        validationErrorPaths({ ...validItemInput(), weight: 2.5 }),
      ).toEqual(['weightUnit']);
      expect(
        validationErrorPaths({
          ...validItemInput(),
          weight: 2.5,
          weightUnit: WeightUnit.KG,
        }),
      ).toEqual([]);
    });

    it('rejects negative measurements and unsupported units', () => {
      expect(
        validationErrorPaths({
          ...validItemInput(),
          weight: -1,
          weightUnit: 'TON',
          dimensions: { length: -1, width: 10, height: 10, unit: 'FT' },
        }),
      ).toEqual([
        'dimensions.length',
        'dimensions.unit',
        'weight',
        'weightUnit',
      ]);
    });

    it('requires every dimension field when dimensions are given', () => {
      expect(
        validationErrorPaths({
          ...validItemInput(),
          dimensions: { length: 10, width: 10 },
        }),
      ).toEqual(['dimensions.height', 'dimensions.unit']);
      expect(
        validationErrorPaths({
          ...validItemInput(),
          dimensions: {
            length: 10,
            width: 10,
            height: 0,
            unit: DimensionUnit.CM,
          },
        }),
      ).toEqual([]);
    });
  });
});
