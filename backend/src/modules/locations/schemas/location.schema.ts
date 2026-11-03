import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';
import { LOCATION_IDENTITY_COLLATION } from '../location-identity';
import { Address, AddressSchema } from './address.schema';

export type LocationDocument = HydratedDocument<Location>;

// Mongoose builds documents from this class's decorator metadata and never calls
// its constructor, hence the definite-assignment `!` on required properties.
@Schema({ collection: 'locations', timestamps: true })
export class Location {
  /**
   * Public ULID identifier. Declaring an `id` path also stops Mongoose from adding
   * its default `id` virtual (which would return `_id` as a string).
   */
  @Prop({
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: generateUlid,
    validate: ulidValidator,
  })
  id!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, enum: Object.values(LocationType) })
  type!: LocationType;

  @Prop({ type: AddressSchema, required: true })
  address!: Address;

  @Prop({ type: String, trim: true })
  contactName?: string;

  @Prop({ type: String, trim: true })
  contactPhone?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(LocationStatus),
    default: LocationStatus.ACTIVE,
  })
  status!: LocationStatus;

  /**
   * Non-core extension data only. Stored as Mixed: after mutating a nested value
   * in place, call `doc.markModified('metadata')` before saving.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const LocationSchema = SchemaFactory.createForClass(Location);

/**
 * Location reuse rule for stores: at most one non-deleted `STORE` per
 * name + contact name + postal code (compared case-insensitively). Other location
 * types and soft-deleted stores are outside the index, so they never conflict.
 */
LocationSchema.index(
  { name: 1, contactName: 1, 'address.postalCode': 1 },
  {
    name: 'store_identity',
    unique: true,
    collation: LOCATION_IDENTITY_COLLATION,
    partialFilterExpression: { type: LocationType.STORE, deletedAt: null },
  },
);
