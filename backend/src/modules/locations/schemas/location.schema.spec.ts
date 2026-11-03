import { Mongoose, Types } from 'mongoose';
import { generateUlid, isValidUlid } from '../../../common/utils/ulid.util';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';
import { Location, LocationSchema } from './location.schema';

// Schema-definition checks only: validation runs in memory, no MongoDB connection.
const LocationModel = new Mongoose().model<Location>(
  Location.name,
  LocationSchema,
);

function validLocationInput() {
  return {
    name: 'Hanoi Cross-Dock',
    type: LocationType.CROSS_DOCK,
    address: {
      addressLine1: '1 Dai Co Viet',
      city: 'Hanoi',
      postalCode: '100000',
    },
  };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new LocationModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('LocationSchema', () => {
  describe('definition', () => {
    it('maps to the locations collection with timestamps enabled', () => {
      expect(LocationSchema.get('collection')).toBe('locations');
      expect(LocationSchema.get('timestamps')).toBe(true);
    });

    it('declares unique indexes on id and on the store identity', () => {
      const indexes = LocationSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique,
      }));

      expect(indexes).toEqual([
        { fields: { id: 1 }, unique: true },
        {
          fields: { name: 1, contactName: 1, 'address.postalCode': 1 },
          unique: true,
        },
      ]);
    });

    it('limits the store identity index to non-deleted stores, compared case-insensitively', () => {
      const [, options] = LocationSchema.indexes()[1];

      expect(options).toMatchObject({
        name: 'store_identity',
        collation: { locale: 'vi', strength: 2 },
        partialFilterExpression: { type: LocationType.STORE, deletedAt: null },
      });
    });

    it('generates id with the shared ULID utility and makes it immutable', () => {
      expect(LocationSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
        required: true,
      });
    });

    it('restricts type and status to their enums, with status defaulting to ACTIVE', () => {
      expect(LocationSchema.path('type').options).toMatchObject({
        enum: ['WAREHOUSE', 'CROSS_DOCK', 'STORE', 'CUSTOMER'],
        required: true,
      });
      expect(LocationSchema.path('status').options).toMatchObject({
        enum: ['ACTIVE', 'INACTIVE'],
        default: LocationStatus.ACTIVE,
      });
    });
  });

  describe('new documents', () => {
    it('accepts a valid location', () => {
      expect(validationErrorPaths(validLocationInput())).toEqual([]);
    });

    it('generates a ULID id and keeps a separate ObjectId _id', () => {
      const location = new LocationModel(validLocationInput());

      expect(isValidUlid(location.get('id'))).toBe(true);
      expect(location._id).toBeInstanceOf(Types.ObjectId);
      expect(location.id).not.toBe(location._id.toString());
    });

    it('keeps an explicitly provided ULID', () => {
      const id = generateUlid();

      expect(new LocationModel({ ...validLocationInput(), id }).id).toBe(id);
    });

    it('defaults status to ACTIVE and is not soft-deleted', () => {
      const location = new LocationModel(validLocationInput());

      expect(location.status).toBe(LocationStatus.ACTIVE);
      expect(location.deletedAt).toBeNull();
    });

    it('has no locationCode and no DOCK type', () => {
      expect(LocationSchema.path('locationCode')).toBeUndefined();
      expect(Object.values(LocationType)).not.toContain('DOCK');
    });

    it('trims string values', () => {
      const location = new LocationModel({
        ...validLocationInput(),
        name: ' Hanoi Warehouse ',
        address: {
          addressLine1: ' 1 Dai Co Viet ',
          postalCode: ' 100000 ',
          country: ' VN ',
        },
      });

      expect(location.name).toBe('Hanoi Warehouse');
      expect(location.address.addressLine1).toBe('1 Dai Co Viet');
      expect(location.address.postalCode).toBe('100000');
      expect(location.address.country).toBe('VN');
    });

    it('stores arbitrary metadata objects', () => {
      const location = new LocationModel({
        ...validLocationInput(),
        metadata: { dockCount: 4, tags: ['cold-chain'] },
      });

      expect(location.validateSync()).toBeUndefined();
      expect(location.metadata).toEqual({ dockCount: 4, tags: ['cold-chain'] });
    });
  });

  describe('validation', () => {
    it('requires name, type, and address', () => {
      expect(validationErrorPaths({})).toEqual(['address', 'name', 'type']);
    });

    it('rejects blank required strings', () => {
      expect(
        validationErrorPaths({
          ...validLocationInput(),
          name: '   ',
        }),
      ).toEqual(['name']);
    });

    it('requires addressLine1 and postalCode in the address, but not country', () => {
      expect(
        validationErrorPaths({
          ...validLocationInput(),
          address: { city: 'Hanoi', postalCode: '  ' },
        }),
      ).toEqual(['address.addressLine1', 'address.postalCode']);
    });

    it('rejects unsupported type and status values', () => {
      expect(
        validationErrorPaths({
          ...validLocationInput(),
          type: 'HUB',
          status: 'DELETED',
        }),
      ).toEqual(['status', 'type']);
    });

    it('rejects an explicit id that is not a ULID', () => {
      expect(
        validationErrorPaths({
          ...validLocationInput(),
          id: '507f1f77bcf86cd799439011',
        }),
      ).toEqual(['id']);
    });
  });
});
