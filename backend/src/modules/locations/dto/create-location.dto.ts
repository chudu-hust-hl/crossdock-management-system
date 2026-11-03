import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';
import { AddressDto } from './address.dto';

/** Manual Location creation by an administrator, e.g. a `CROSS_DOCK` facility. */
export class CreateLocationDto {
  @ApiProperty({ example: 'Hanoi Cross-dock 1' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    enum: LocationType,
    enumName: 'LocationType',
    example: LocationType.CROSS_DOCK,
  })
  @IsEnum(LocationType)
  type!: LocationType;

  @ApiProperty({ type: AddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  /** Required for a `STORE`: it is part of the store reuse rule. */
  @ApiPropertyOptional({
    description:
      'Required when `type` is `STORE` (part of the store reuse rule); optional otherwise.',
    example: 'Nguyen Van A',
  })
  @ValidateIf(
    (dto: CreateLocationDto) =>
      dto.type === LocationType.STORE || dto.contactName !== undefined,
  )
  @Trim()
  @IsString()
  @IsNotEmpty()
  contactName?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @Trim()
  @IsString()
  contactPhone?: string;

  /** Defaults to `ACTIVE` in the schema when omitted. */
  @ApiPropertyOptional({
    enum: LocationStatus,
    enumName: 'LocationStatus',
    default: LocationStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Free-form extra attributes.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
