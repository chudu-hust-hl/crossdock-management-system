import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';
import { DockTaskStatus } from '../enums/dock-task-status.enum';

/** `GET /dock-tasks?locationId=&routeId=`: the dock screen's task list. */
export class ListDockTasksQueryDto {
  @ApiProperty({ description: 'ULID of the Location (the dock).' })
  @IsUlid()
  locationId!: string;

  @ApiProperty({ description: 'ULID of the route.' })
  @IsUlid()
  routeId!: string;

  @ApiPropertyOptional({
    enum: DockTaskStatus,
    enumName: 'DockTaskStatus',
    default: DockTaskStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(DockTaskStatus)
  status: DockTaskStatus = DockTaskStatus.PENDING;
}
