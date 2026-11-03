import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SortOrder } from '../../../common/enums/sort-order.enum';
import { LocationSortField } from '../enums/location-sort-field.enum';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';

/**
 * Filters, sorting and paging of `GET /locations`,
 * e.g. `?type=CROSS_DOCK&status=ACTIVE&name=hanoi&page=2&limit=10`.
 */
export class ListLocationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LocationType, enumName: 'LocationType' })
  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;

  @ApiPropertyOptional({ enum: LocationStatus, enumName: 'LocationStatus' })
  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;

  @ApiPropertyOptional({
    description: 'Part of the name, ignoring case.',
    example: 'cross-dock',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Part of the contact name, ignoring case.',
    example: 'Nguyen',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  contactName?: string;

  @ApiPropertyOptional({
    description: 'Exact postal code of the address.',
    example: '100000',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  postalCode?: string;

  @ApiPropertyOptional({
    enum: LocationSortField,
    enumName: 'LocationSortField',
    default: LocationSortField.NAME,
  })
  @IsOptional()
  @IsEnum(LocationSortField)
  sortBy: LocationSortField = LocationSortField.NAME;

  @ApiPropertyOptional({
    enum: SortOrder,
    enumName: 'SortOrder',
    default: SortOrder.ASC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
