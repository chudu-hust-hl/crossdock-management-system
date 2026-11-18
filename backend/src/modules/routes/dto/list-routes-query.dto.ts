import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { RouteSlot } from '../enums/route-slot.enum';
import { RouteStatus } from '../enums/route-status.enum';

/**
 * Filters and paging of `GET /routes`.
 * Sort is fixed: `appointment.from` ascending, then `id`.
 */
export class ListRoutesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RouteStatus, enumName: 'RouteStatus' })
  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;

  @ApiPropertyOptional({
    description: 'Part of the route number, ignoring case.',
    example: 'R-0001',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  routeNumber?: string;

  @ApiPropertyOptional({
    description: 'Exact service date, `YYYY-MM-DD` (Vietnam calendar day).',
    example: '2026-11-18',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate?: string;

  @ApiPropertyOptional({ enum: RouteSlot, enumName: 'RouteSlot' })
  @IsOptional()
  @IsEnum(RouteSlot)
  slot?: RouteSlot;
}
