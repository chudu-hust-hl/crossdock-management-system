import { Mongoose } from 'mongoose';
import { generateUlid, isValidUlid } from '../../../common/utils/ulid.util';
import { MetadataScope } from '../enums/metadata-scope.enum';
import { Metadata, MetadataSchema } from './metadata.schema';

// Schema-definition checks only: validation runs in memory, no MongoDB connection.
const MetadataModel = new Mongoose().model<Metadata>(
  Metadata.name,
  MetadataSchema,
);

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new MetadataModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('MetadataSchema', () => {
  it('maps to the metadata collection with timestamps enabled', () => {
    expect(MetadataSchema.get('collection')).toBe('metadata');
    expect(MetadataSchema.get('timestamps')).toBe(true);
  });

  it('declares unique indexes on id and on scope + key', () => {
    const indexes = MetadataSchema.indexes().map(([fields, options]) => ({
      fields,
      unique: options.unique,
    }));

    expect(indexes).toEqual([
      { fields: { id: 1 }, unique: true },
      { fields: { scope: 1, key: 1 }, unique: true },
    ]);
  });

  it('generates id with the shared ULID utility and makes it immutable', () => {
    expect(MetadataSchema.path('id').options).toMatchObject({
      default: generateUlid,
      immutable: true,
      required: true,
    });
  });

  it('accepts a counter entry and is not soft-deleted', () => {
    const entry = new MetadataModel({
      scope: MetadataScope.BUSINESS_CODE_COUNTER,
      key: ' SHIPMENT-1026 ',
      value: 1,
    });

    expect(entry.validateSync()).toBeUndefined();
    expect(isValidUlid(entry.get('id'))).toBe(true);
    expect(entry.key).toBe('SHIPMENT-1026');
    expect(entry.deletedAt).toBeNull();
  });

  it('requires scope, key, and value', () => {
    expect(validationErrorPaths({})).toEqual(['key', 'scope', 'value']);
  });

  it('rejects an unknown scope', () => {
    expect(
      validationErrorPaths({ scope: 'ROUTING', key: 'k', value: 1 }),
    ).toEqual(['scope']);
  });
});
