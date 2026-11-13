import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';
import { UlidParamDto } from '../../../common/dto/ulid-param.dto';

/** Route parameters of `/shipments/:id/items/:itemId`; both are public ULIDs. */
export class ShipmentItemParamDto extends UlidParamDto {
  @ApiProperty({
    description: 'Public ULID of an Item of this shipment.',
    example: '01M5HM0P9Q8R7S6T5V4W3X2Y1Z',
  })
  @IsUlid()
  itemId!: string;
}
