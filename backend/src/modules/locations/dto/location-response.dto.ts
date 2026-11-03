import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { Page } from '../../../common/utils/pagination.util';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';
import { Address } from '../schemas/address.schema';
import { Location } from '../schemas/location.schema';
import { AddressDto } from './address.dto';

/** A Location as returned by the API: public ULID `id`, no `_id` or `deletedAt`. */
export class LocationResponse {
  @ApiProperty({
    description: 'Public ULID.',
    example: '01M5HJ2FXJ9RYWMT6YT7YX9KH7',
  })
  id!: string;

  @ApiProperty({ example: 'Hanoi Cross-dock 1' })
  name!: string;

  @ApiProperty({ enum: LocationType, enumName: 'LocationType' })
  type!: LocationType;

  @ApiProperty({ type: AddressDto })
  address!: Address;

  @ApiPropertyOptional()
  contactName?: string;

  @ApiPropertyOptional()
  contactPhone?: string;

  @ApiProperty({ enum: LocationStatus, enumName: 'LocationStatus' })
  status!: LocationStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** One page of `GET /locations`. */
export class LocationPageResponse extends PageResponse {
  @ApiProperty({ type: [LocationResponse] })
  items!: LocationResponse[];
}

export function toLocationPageResponse(
  page: Page<Location>,
): LocationPageResponse {
  return { ...page, items: page.items.map(toLocationResponse) };
}

export function toLocationResponse(location: Location): LocationResponse {
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    address: location.address,
    contactName: location.contactName,
    contactPhone: location.contactPhone,
    status: location.status,
    metadata: location.metadata,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}
