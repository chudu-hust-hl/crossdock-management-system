import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SortOrder } from '../../../common/enums/sort-order.enum';
import { ShipmentSortField } from '../enums/shipment-sort-field.enum';
import { ShipmentStatus } from '../enums/shipment-status.enum';

const ULID_EXAMPLE = '01M5HJ2FXJ9RYWMT6YT7YX9KH7';

/**
 * Filters, sorting and paging of `GET /shipments`,
 * e.g. `?isRoot=true&status=CREATED&customerName=abc&page=1&limit=20`.
 */
export class ListShipmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ShipmentStatus, enumName: 'ShipmentStatus' })
  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

  @ApiPropertyOptional({
    description: 'Part of the shipment code, ignoring case.',
    example: 'S-0001',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ApiPropertyOptional({
    description: 'Part of the customer name, ignoring case.',
    example: 'ABC',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  customerName?: string;

  @ApiPropertyOptional({
    description:
      '`true`: only root shipments (bookings); `false`: only segments (legs).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isRoot?: boolean;

  @ApiPropertyOptional({
    description: 'Only the segments of this root shipment (ULID).',
    example: ULID_EXAMPLE,
  })
  @IsOptional()
  @IsUlid()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Only shipments that contain this Item (ULID).',
    example: ULID_EXAMPLE,
  })
  @IsOptional()
  @IsUlid()
  itemId?: string;

  @ApiPropertyOptional({
    description:
      'Only shipments with a delivery point (pickup, transit or drop-off) at this Location (ULID).',
    example: ULID_EXAMPLE,
  })
  @IsOptional()
  @IsUlid()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ShipmentSortField,
    enumName: 'ShipmentSortField',
    default: ShipmentSortField.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(ShipmentSortField)
  sortBy: ShipmentSortField = ShipmentSortField.CREATED_AT;

  @ApiPropertyOptional({
    enum: SortOrder,
    enumName: 'SortOrder',
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.DESC;
}
