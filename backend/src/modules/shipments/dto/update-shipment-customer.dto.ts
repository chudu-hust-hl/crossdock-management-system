import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** `PUT /shipments/:id`: the only booking field changed by this endpoint. */
export class UpdateShipmentCustomerDto {
  @ApiProperty({ example: 'Cong ty TNHH ABC' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  customerName!: string;
}
