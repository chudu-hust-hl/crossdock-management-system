import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { MetadataScope } from '../enums/metadata-scope.enum';

/**
 * A value or rule that may change, identified by `scope` + `key`, e.g. the
 * business-code counter `{ scope: BUSINESS_CODE_COUNTER, key: 'SHIPMENT-1026', value: 12 }`.
 */
@Schema({ collection: 'metadata', timestamps: true })
export class Metadata {
  @Prop({
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: generateUlid,
    validate: ulidValidator,
  })
  id!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(MetadataScope),
  })
  scope!: MetadataScope;

  @Prop({ type: String, required: true, trim: true })
  key!: string;

  /** Its shape depends on the scope: a number for a counter. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: unknown;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MetadataSchema = SchemaFactory.createForClass(Metadata);

MetadataSchema.index({ scope: 1, key: 1 }, { unique: true });
