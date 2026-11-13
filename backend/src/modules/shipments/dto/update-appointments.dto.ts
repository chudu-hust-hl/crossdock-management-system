import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { TimeWindowDto } from '../../../common/dto/time-window.dto';

/**
 * `PUT /shipments/:id/appointments`: both store windows, always together.
 * `ShipmentEditsService` also requires `from` before `to` in each window, and the
 * pickup to end no later than the drop-off starts.
 */
export class UpdateAppointmentsDto {
  @ApiProperty({ type: TimeWindowDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TimeWindowDto)
  pickup!: TimeWindowDto;

  @ApiProperty({ type: TimeWindowDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TimeWindowDto)
  dropoff!: TimeWindowDto;
}
