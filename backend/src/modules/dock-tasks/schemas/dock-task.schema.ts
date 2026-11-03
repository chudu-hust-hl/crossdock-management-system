import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { TASK_NUMBER_PATTERN } from '../../../common/constants/business-code-patterns';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { DockTaskStatus } from '../enums/dock-task-status.enum';
import { DockTaskType } from '../enums/dock-task-type.enum';

export type DockTaskDocument = HydratedDocument<DockTask>;

/**
 * One operational action on exactly one item. Which leg references a task type
 * needs is validated in the service layer, not here.
 */
@Schema({ collection: 'dock_tasks', timestamps: true })
export class DockTask {
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
      TASK_NUMBER_PATTERN,
      '`{VALUE}` is not a valid task number (<nnnn>-MMYY)',
    ],
  })
  taskNumber!: string;

  /** ULID `id` of the Item. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  itemId!: string;

  /** ULID `id` of the Shipment. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  shipmentId!: string;

  /** ULID `id` of the Route. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  routeId!: string;

  /** ULID `id` of the Location where the action happens. */
  @Prop({ type: String, required: true, validate: ulidValidator })
  locationId!: string;

  /** ULID `id` of the leg (child Shipment) on which the item arrived. */
  @Prop({ type: String, default: null, validate: ulidValidator })
  inboundLegId!: string | null;

  /** ULID `id` of the leg (child Shipment) on which the item leaves. */
  @Prop({ type: String, default: null, validate: ulidValidator })
  outboundLegId!: string | null;

  @Prop({ type: String, required: true, enum: Object.values(DockTaskType) })
  type!: DockTaskType;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DockTaskStatus),
    default: DockTaskStatus.PENDING,
  })
  status!: DockTaskStatus;

  /** ULID `id` of the User who performed the task. */
  @Prop({ type: String, default: null, validate: ulidValidator })
  performedBy!: string | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ type: String, trim: true })
  errorCode?: string;

  @Prop({ type: String, trim: true })
  errorMessage?: string;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const DockTaskSchema = SchemaFactory.createForClass(DockTask);

DockTaskSchema.index({ itemId: 1, createdAt: -1 });
DockTaskSchema.index({ routeId: 1, locationId: 1, status: 1 });
DockTaskSchema.index({ shipmentId: 1, type: 1, status: 1 });
