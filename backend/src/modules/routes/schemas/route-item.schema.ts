import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ITEM_CODE_PATTERN } from '../../../common/constants/business-code-patterns';
import { ulidValidator } from '../../../common/utils/ulid.util';
import { ItemUnit } from '../../items/enums/item-unit.enum';
import { WeightUnit } from '../../items/enums/weight-unit.enum';

/**
 * Snapshot of one Item on a route, copied at assignment.
 * Later changes to the Item (status, location) are not written back here. Only a
 * correction of the booked item rewrites `description`, `itemUnit` and the weight.
 */
@Schema({ _id: false })
export class RouteItem {
  /** ULID `id` of the Item. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  itemId!: string;

  /** ULID `id` of the child shipment that carries this item on the route. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  shipmentId!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    match: [
      ITEM_CODE_PATTERN,
      '`{VALUE}` is not a valid item code (T-<nnnn>-MMYY)',
    ],
  })
  itemCode!: string;

  @Prop({ type: String, required: true, trim: true })
  barcode!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: String, required: true, enum: Object.values(ItemUnit) })
  itemUnit!: ItemUnit;

  @Prop({ type: Number, required: true, min: 0 })
  weight!: number;

  @Prop({ type: String, required: true, enum: Object.values(WeightUnit) })
  weightUnit!: WeightUnit;
}

export const RouteItemSchema = SchemaFactory.createForClass(RouteItem);
