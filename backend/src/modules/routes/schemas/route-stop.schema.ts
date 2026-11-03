import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import {
  TimeWindow,
  TimeWindowSchema,
} from '../../../common/schemas/time-window.schema';
import { ulidValidator } from '../../../common/utils/ulid.util';

/** Embedded in Route; not a collection. Stops are identified and ordered by `sequence`. */
@Schema({ _id: false })
export class RouteStop {
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: (sequence: number) => Number.isInteger(sequence),
      message: '`sequence` must be an integer',
    },
  })
  sequence!: number;

  /** ULID `id` of the Location. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  locationId!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DeliveryPointType),
  })
  type!: DeliveryPointType;

  /** ULID `id`s of the segments handled at this stop; expected to be a subset of the route's `shipmentIds`. */
  @Prop({ type: [{ type: String, validate: ulidValidator }], default: [] })
  shipmentIds!: string[];

  @Prop({ type: TimeWindowSchema, required: true, default: () => ({}) })
  appointment!: TimeWindow;

  @Prop({ type: TimeWindowSchema, required: true, default: () => ({}) })
  actualWindow!: TimeWindow;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DeliveryPointStatus),
    default: DeliveryPointStatus.PENDING,
  })
  status!: DeliveryPointStatus;
}

export const RouteStopSchema = SchemaFactory.createForClass(RouteStop);
