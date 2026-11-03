import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { ROUTE_NUMBER_PATTERN } from '../../../common/constants/business-code-patterns';
import {
  TimeWindow,
  TimeWindowSchema,
} from '../../../common/schemas/time-window.schema';
import { hasUniqueSequences } from '../../../common/utils/sequence.util';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { RouteStatus } from '../enums/route-status.enum';
import { RouteStop, RouteStopSchema } from './route-stop.schema';

export type RouteDocument = HydratedDocument<Route>;

@Schema({ collection: 'routes', timestamps: true })
export class Route {
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
      ROUTE_NUMBER_PATTERN,
      '`{VALUE}` is not a valid route number (R-<nnnn>-MMYY)',
    ],
  })
  routeNumber!: string;

  /** ULID `id`s of the shipment segments carried by this route. */
  @Prop({ type: [{ type: String, validate: ulidValidator }], default: [] })
  shipmentIds!: string[];

  @Prop({
    type: [RouteStopSchema],
    default: [],
    validate: {
      validator: hasUniqueSequences,
      message: 'Each stop must have a different `sequence`',
    },
  })
  stops!: RouteStop[];

  @Prop({
    type: String,
    required: true,
    enum: Object.values(RouteStatus),
    default: RouteStatus.PLANNED,
  })
  status!: RouteStatus;

  @Prop({ type: TimeWindowSchema, required: true, default: () => ({}) })
  appointment!: TimeWindow;

  @Prop({ type: TimeWindowSchema, required: true, default: () => ({}) })
  actualWindow!: TimeWindow;

  /** ULID `id` of the User who created the route. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  createdBy!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const RouteSchema = SchemaFactory.createForClass(Route);

RouteSchema.index({ shipmentIds: 1 });
RouteSchema.index({ status: 1, 'appointment.from': 1 });
