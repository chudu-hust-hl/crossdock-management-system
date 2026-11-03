/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { SHIPMENT_CODE_PATTERN } from '../../../common/constants/business-code-patterns';
import { hasUniqueSequences } from '../../../common/utils/sequence.util';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { DeliveryInfo, DeliveryInfoSchema } from './delivery-info.schema';

export type ShipmentDocument = HydratedDocument<Shipment>;

/**
 * One collection for root shipments (`parentId: null`) and their segments.
 * `parentId` is the only stored parent-child link; segments are found with
 * `find({ parentId })`. Locations live in `deliveryInfos`, not in origin/destination fields.
 */
@Schema({ collection: 'shipments', timestamps: true })
export class Shipment {
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
      SHIPMENT_CODE_PATTERN,
      '`{VALUE}` is not a valid shipment code (S-<nnnn>-MMYY)',
    ],
  })
  code!: string;

  /** ULID `id` of the parent Shipment; `null` for a root shipment. */
  @Prop({
    type: String,
    default: null,
    validate: [
      ulidValidator,
      {
        validator: function (this: ShipmentDocument, parentId: string | null) {
          return parentId == null || parentId !== this.id;
        },
        message: 'A shipment cannot be its own parent',
      },
    ],
  })
  parentId!: string | null;

  /** Who booked the shipment. Required on a root shipment; segments have none. */
  @Prop({
    type: String,
    trim: true,
    required: function (this: Shipment) {
      return this.parentId == null;
    },
  })
  customerName?: string;

  /**
   * Booking price in whole VND, calculated by `ShipmentCostService`.
   * Required on a root shipment; segments have none.
   */
  @Prop({
    type: Number,
    min: 0,
    required: function (this: Shipment) {
      return this.parentId == null;
    },
  })
  cost?: number;

  /** ULID `id`s of the Items in this shipment or segment. */
  @Prop({ type: [{ type: String, validate: ulidValidator }], default: [] })
  itemIds!: string[];

  @Prop({
    type: [DeliveryInfoSchema],
    default: [],
    validate: {
      validator: hasUniqueSequences,
      message: 'Each delivery info must have a different `sequence`',
    },
  })
  deliveryInfos!: DeliveryInfo[];

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ShipmentStatus),
    default: ShipmentStatus.CREATED,
  })
  status!: ShipmentStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);

ShipmentSchema.index({ parentId: 1 });
ShipmentSchema.index({ itemIds: 1 });
ShipmentSchema.index({ status: 1, updatedAt: -1 });
