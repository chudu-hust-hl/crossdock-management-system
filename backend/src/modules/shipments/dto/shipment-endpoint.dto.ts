import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { TimeWindowDto } from '../../../common/dto/time-window.dto';
import { LocationCandidateDto } from '../../locations/dto/location-candidate.dto';

/** The pickup or drop-off end of a new shipment. */
export class ShipmentEndpointDto {
  @ApiProperty({
    type: LocationCandidateDto,
    description:
      'Resolved to a STORE: an existing store with the same name, contactName and postalCode is reused.',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationCandidateDto)
  location!: LocationCandidateDto;

  /** Supplied when the shipment is created (docs/domain-model.md, question 24). */
  @ApiProperty({ type: TimeWindowDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TimeWindowDto)
  appointment!: TimeWindowDto;
}
