import { Mongoose, Types } from 'mongoose';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { DeliveryInfoSchema } from './delivery-info.schema';
import { Shipment, ShipmentSchema } from './shipment.schema';

const ShipmentModel = new Mongoose().model<Shipment>(
  Shipment.name,
  ShipmentSchema,
);

function deliveryInfo(sequence: number, type: DeliveryPointType) {
  return { sequence, type, locationId: generateUlid() };
}

function validShipmentInput() {
  return {
    code: 'S-0001-1026',
    customerName: 'Cong ty TNHH ABC',
    cost: 47500,
    deliveryInfos: [
      deliveryInfo(1, DeliveryPointType.PICKUP),
      deliveryInfo(2, DeliveryPointType.DROPOFF),
    ],
  };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new ShipmentModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('ShipmentSchema', () => {
  describe('definition', () => {
    it('maps to the shipments collection with timestamps enabled', () => {
      expect(ShipmentSchema.get('collection')).toBe('shipments');
      expect(ShipmentSchema.get('timestamps')).toBe(true);
    });

    it('declares unique id and code plus parent, item, and status query indexes', () => {
      const indexes = ShipmentSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique === true,
      }));

      expect(indexes).toEqual(
        expect.arrayContaining([
          { fields: { id: 1 }, unique: true },
          { fields: { code: 1 }, unique: true },
          { fields: { parentId: 1 }, unique: false },
          { fields: { itemIds: 1 }, unique: false },
          { fields: { status: 1, updatedAt: -1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(5);
    });

    it('generates id with the shared ULID utility', () => {
      expect(ShipmentSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
      });
    });

    it('references parent shipments, children, items, and locations by their ULID id', () => {
      expect(ShipmentSchema.path('parentId').instance).toBe('String');
      expect(ShipmentSchema.path('parentId').options.ref).toBeUndefined();
      expect(ShipmentSchema.path('childrenIds').options).toMatchObject({
        type: [{ type: String, validate: ulidValidator }],
        default: [],
      });
      expect(ShipmentSchema.path('itemIds').options).toMatchObject({
        type: [{ type: String, validate: ulidValidator }],
      });
      expect(DeliveryInfoSchema.path('locationId').instance).toBe('String');
      expect(DeliveryInfoSchema.path('locationId').options).toMatchObject({
        required: true,
        validate: ulidValidator,
      });
    });

    it('rejects ObjectIds in every reference', () => {
      const objectId = new Types.ObjectId().toString();

      expect(
        validationErrorPaths({
          code: 'S-0001-1026',
          parentId: objectId,
          childrenIds: [objectId],
          itemIds: [generateUlid(), objectId],
          deliveryInfos: [
            {
              sequence: 1,
              type: DeliveryPointType.PICKUP,
              locationId: objectId,
            },
          ],
        }),
      ).toEqual([
        'childrenIds.0',
        'deliveryInfos.0.locationId',
        'itemIds.1',
        'parentId',
      ]);
    });

    it('does not define obsolete or duplicate sources of truth', () => {
      for (const field of [
        'shipmentNumber',
        'originLocationId',
        'destinationLocationId',
        'origin',
        'destination',
      ]) {
        expect(ShipmentSchema.path(field)).toBeUndefined();
      }
    });

    it('embeds delivery infos without an _id', () => {
      expect(DeliveryInfoSchema.path('_id')).toBeUndefined();
    });

    it('allows exactly the documented shipment statuses', () => {
      expect(ShipmentSchema.path('status').options).toMatchObject({
        enum: [
          'CREATED',
          'IN_TRANSIT',
          'AT_DOCK',
          'DELIVERED',
          'CANCELLED',
          'EXCEPTION',
        ],
        default: ShipmentStatus.CREATED,
      });
    });
  });

  describe('new documents', () => {
    it('is a root shipment with no items by default', () => {
      const shipment = new ShipmentModel({
        code: 'S-0001-1026',
        customerName: 'Cong ty TNHH ABC',
        cost: 0,
      });

      expect(shipment.validateSync()).toBeUndefined();
      expect(shipment.parentId).toBeNull();
      expect(shipment.childrenIds).toEqual([]);
      expect(shipment.itemIds).toEqual([]);
      expect(shipment.deliveryInfos).toEqual([]);
      expect(shipment.status).toBe(ShipmentStatus.CREATED);
    });

    it('defaults each delivery info to PENDING with empty time windows', () => {
      const shipment = new ShipmentModel(validShipmentInput());
      const [pickup] = shipment.toObject().deliveryInfos;

      expect(pickup).toMatchObject({
        status: DeliveryPointStatus.PENDING,
        appointment: { from: null, to: null },
        actualWindow: { from: null, to: null },
      });
    });

    it('accepts a segment that references its parent', () => {
      expect(
        validationErrorPaths({
          ...validShipmentInput(),
          parentId: generateUlid(),
          itemIds: [generateUlid(), generateUlid()],
        }),
      ).toEqual([]);
    });
  });

  describe('validation', () => {
    it('requires a code, and a customer and cost on a root shipment', () => {
      expect(validationErrorPaths({})).toEqual([
        'code',
        'cost',
        'customerName',
      ]);
    });

    it('does not require a customer or cost on a segment', () => {
      expect(
        validationErrorPaths({
          code: 'S-0002-1026',
          parentId: generateUlid(),
        }),
      ).toEqual([]);
    });

    it('trims the customer name and rejects a negative or blank value', () => {
      const shipment = new ShipmentModel({
        ...validShipmentInput(),
        customerName: '  Cong ty TNHH ABC  ',
      });
      expect(shipment.customerName).toBe('Cong ty TNHH ABC');

      expect(
        validationErrorPaths({
          ...validShipmentInput(),
          customerName: '   ',
          cost: -1,
        }),
      ).toEqual(['cost', 'customerName']);
    });

    it('requires code in the S-<nnnn>-MMYY format', () => {
      expect(
        validationErrorPaths({ ...validShipmentInput(), code: 'S-0120-1026' }),
      ).toEqual([]);
      expect(
        validationErrorPaths({ ...validShipmentInput(), code: 'SHP-120' }),
      ).toEqual(['code']);
    });

    it('is not soft-deleted by default', () => {
      expect(new ShipmentModel(validShipmentInput()).deletedAt).toBeNull();
    });

    it('rejects a shipment that is its own parent', () => {
      const shipment = new ShipmentModel(validShipmentInput());
      shipment.parentId = shipment.get('id');

      expect(Object.keys(shipment.validateSync()?.errors ?? {})).toEqual([
        'parentId',
      ]);
    });

    it('requires sequence, locationId, and a supported type for each delivery info', () => {
      expect(
        validationErrorPaths({
          ...validShipmentInput(),
          deliveryInfos: [{ type: 'ORIGIN' }],
        }),
      ).toEqual([
        'deliveryInfos.0.locationId',
        'deliveryInfos.0.sequence',
        'deliveryInfos.0.type',
      ]);
    });

    it('requires sequence to be a positive integer', () => {
      expect(
        validationErrorPaths({
          ...validShipmentInput(),
          deliveryInfos: [
            deliveryInfo(0, DeliveryPointType.PICKUP),
            deliveryInfo(1.5, DeliveryPointType.DROPOFF),
          ],
        }),
      ).toEqual(['deliveryInfos.0.sequence', 'deliveryInfos.1.sequence']);
    });

    it('rejects repeated sequence numbers', () => {
      expect(
        validationErrorPaths({
          ...validShipmentInput(),
          deliveryInfos: [
            deliveryInfo(1, DeliveryPointType.PICKUP),
            deliveryInfo(1, DeliveryPointType.DROPOFF),
          ],
        }),
      ).toEqual(['deliveryInfos']);
    });
  });
});
