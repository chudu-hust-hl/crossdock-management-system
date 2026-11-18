import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DockTaskStatus } from '../enums/dock-task-status.enum';
import { DockTaskType } from '../enums/dock-task-type.enum';
import { DockTask } from '../schemas/dock-task.schema';

/** A DockTask as returned by the API: public ULID `id`, no `_id` or `deletedAt`. */
export class DockTaskResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: '0001-1126' })
  taskNumber!: string;

  @ApiProperty({ enum: DockTaskType, enumName: 'DockTaskType' })
  type!: DockTaskType;

  @ApiProperty({ enum: DockTaskStatus, enumName: 'DockTaskStatus' })
  status!: DockTaskStatus;

  @ApiProperty({ description: 'ULID of the Item.' })
  itemId!: string;

  @ApiProperty({
    description: 'ULID of the leg (child shipment) this task is about.',
  })
  shipmentId!: string;

  @ApiProperty({ description: 'ULID of the route.' })
  routeId!: string;

  @ApiProperty({
    description: 'ULID of the Location where the action happens.',
  })
  locationId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Leg the item arrives on.',
  })
  inboundLegId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Leg the item leaves on.',
  })
  outboundLegId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ULID of the user who completed the task.',
  })
  performedBy!: string | null;

  @ApiProperty({ type: Date, nullable: true })
  completedAt!: Date | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      '`reason` (MANUAL_PICKUP, MANUAL_DELIVERY, MISSING) and `podPath` of a scan photo.',
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'MISSING' })
  errorCode?: string;

  @ApiPropertyOptional({ example: 'Not on the truck when it was unloaded' })
  errorMessage?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** One row of `GET /dock-tasks`: the task and the item as the route snapshot shows it. */
export class DockTaskRowResponse extends DockTaskResponse {
  @ApiProperty({ type: String, nullable: true, example: 'T-0001-1126' })
  itemCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '8930000000017' })
  barcode!: string | null;
}

/** What a dock action wrote: the tasks it completed and the next PENDING tasks. */
export class DockActionResponse {
  @ApiProperty({ type: [DockTaskResponse] })
  completedTasks!: DockTaskResponse[];

  @ApiProperty({ type: [DockTaskResponse] })
  pendingTasks!: DockTaskResponse[];
}

export function toDockTaskResponse(task: DockTask): DockTaskResponse {
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    type: task.type,
    status: task.status,
    itemId: task.itemId,
    shipmentId: task.shipmentId,
    routeId: task.routeId,
    locationId: task.locationId,
    inboundLegId: task.inboundLegId,
    outboundLegId: task.outboundLegId,
    performedBy: task.performedBy,
    completedAt: task.completedAt,
    metadata: task.metadata,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toDockActionResponse(result: {
  completed: DockTask[];
  pending: DockTask[];
}): DockActionResponse {
  return {
    completedTasks: result.completed.map(toDockTaskResponse),
    pendingTasks: result.pending.map(toDockTaskResponse),
  };
}
