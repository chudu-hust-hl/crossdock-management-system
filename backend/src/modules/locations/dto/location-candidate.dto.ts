import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { AddressDto } from './address.dto';

/**
 * Location details supplied together with other data (a shipment's pickup or
 * drop-off), which a service resolves to an existing Location or creates.
 *
 * `name`, `contactName`, and `address.postalCode` are all required because they
 * form the Location reuse rule (docs/business-workflows.md). `type` and `status`
 * are not accepted: the service decides them.
 */
export class LocationCandidateDto {
  @ApiProperty({ example: 'Store A' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @ApiPropertyOptional({
    example: '0901234567',
    description:
      'Not used for matching; an existing store keeps its own phone.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  contactPhone?: string;

  @ApiProperty({ type: AddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}
