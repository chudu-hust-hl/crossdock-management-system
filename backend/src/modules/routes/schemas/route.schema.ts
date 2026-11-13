import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { ROUTE_NUMBER_PATTERN } from '../../../common/constants/business-code-patterns';
import {
  TimeWindow,
  TimeWindowSchema,
} from '../../../common/schemas/time-window.schema';
import { hasUniqueSequences } from '../../../common/utils/sequence.util';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { RouteSlot } from '../enums/route-slot.enum';
import { RouteStatus } from '../enums/route-status.enum';
import { RouteItem, RouteItemSchema } from './route-item.schema';
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

  /** ULID `id`s of the child shipments carried by this route. The root is never listed. */
  @Prop({ type: [{ type: String, validate: ulidValidator }], default: [] })
  shipmentIds!: string[];

  /**
   * Item snapshots copied at assignment. A scan does not update them; a correction of
   * the booked item (`PUT /shipments/:id/items/:itemId`) rewrites its rows.
   */
  @Prop({ type: [RouteItemSchema], default: [] })
  items!: RouteItem[];

  @Prop({
    type: [RouteStopSchema],
    default: [],
    validate: {
      validator: hasUniqueSequences,
      message: 'Each stop must have a different `sequence`',
    },
  })
  stops!: RouteStop[];

  /** ULID `id` of stop 1. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  fromLocationId!: string;

  /** ULID `id` of stop 2. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  toLocationId!: string;

  /**
   * `YYYY-MM-DD` in Vietnam time. Set only on a dock–dock route, together with `slot`.
   */
  @Prop({
    type: String,
    trim: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, '`{VALUE}` is not a date (YYYY-MM-DD)'],
    required: function (this: Route) {
      return this.slot != null;
    },
  })
  serviceDate?: string;

  /** Set only on a dock–dock route, together with `serviceDate`. */
  @Prop({
    type: String,
    enum: Object.values(RouteSlot),
    required: function (this: Route) {
      return this.serviceDate != null;
    },
  })
  slot?: RouteSlot;

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

  @Prop({ type: String, required: true, trim: true })
  driverName!: string;

  @Prop({ type: String, required: true, trim: true })
  vehiclePlate!: string;

  /**
   * ULID `id` of the User who created the route.
   * Booking writes the placeholder; it does not look up a User.
   */
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
/**
 * One non-deleted dock–dock route per direction, Vietnam day, and slot.
 * Store–dock routes omit `slot`, so they stay outside this index.
 */
RouteSchema.index(
  { fromLocationId: 1, toLocationId: 1, serviceDate: 1, slot: 1 },
  {
    name: 'dock_lane',
    unique: true,
    partialFilterExpression: {
      slot: { $exists: true },
      deletedAt: null,
    },
  },
);
