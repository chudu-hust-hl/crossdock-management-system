import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { ITEM_CODE_PATTERN } from '../../../common/constants/business-code-patterns';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { ItemStatus } from '../enums/item-status.enum';
import { ItemUnit } from '../enums/item-unit.enum';
import { WeightUnit } from '../enums/weight-unit.enum';
import { Dimensions, DimensionsSchema } from './dimensions.schema';

export type ItemDocument = HydratedDocument<Item>;

/**
 * One physical item for its whole journey: it is created by the booking of its shipment
 * and is never booked again. The same document is referenced by every shipment segment
 * that carries it through routing. Movement history lives in DockTask records.
 */
@Schema({ collection: 'items', timestamps: true })
export class Item {
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
    unique: true,
    trim: true,
    match: [
      ITEM_CODE_PATTERN,
      '`{VALUE}` is not a valid item code (T-<nnnn>-MMYY)',
    ],
  })
  itemCode!: string;

  @Prop({ type: String, required: true, unique: true, trim: true })
  barcode!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  /** Packaging unit: `BOX`, `PALLET`, `KEG`, or `BAG`. */
  @Prop({ type: String, required: true, enum: Object.values(ItemUnit) })
  itemUnit!: ItemUnit;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ItemStatus),
    default: ItemStatus.CREATED,
  })
  status!: ItemStatus;

  /** ULID `id` of the Location where the item is now. */
  @Prop({ type: String, validate: ulidValidator })
  currentLocationId?: string;

  /** ULID `id` of the Shipment (segment) currently carrying the item. */
  @Prop({ type: String, validate: ulidValidator })
  currentShipmentId?: string;

  @Prop({ type: Number, min: 0 })
  weight?: number;

  @Prop({
    type: String,
    enum: Object.values(WeightUnit),
    required: function (this: Item) {
      return this.weight != null;
    },
  })
  weightUnit?: WeightUnit;

  @Prop({ type: DimensionsSchema })
  dimensions?: Dimensions;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ItemSchema = SchemaFactory.createForClass(Item);

ItemSchema.index({ currentLocationId: 1, status: 1 });
