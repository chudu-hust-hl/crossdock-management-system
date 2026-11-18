import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ListRoutesQueryDto } from './list-routes-query.dto';

/** Which end of the route is the dock the caller is standing at. */
export enum DockDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

/**
 * `GET /docks/:locationId/routes`. `direction` is required.
 * The other filters and the paging are the same as `GET /routes`.
 */
export class ListDockRoutesQueryDto extends ListRoutesQueryDto {
  @ApiProperty({
    enum: DockDirection,
    enumName: 'DockDirection',
    description:
      '`inbound`: this dock is `toLocationId`. `outbound`: this dock is `fromLocationId`.',
  })
  @IsEnum(DockDirection)
  direction!: DockDirection;
}
