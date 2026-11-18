import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray } from 'class-validator';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';

const ULID_EXAMPLE = '01M5HJ2FXJ9RYWMT6YT7YX9KH7';

/** Body of `POST /routes/:id/shipments`: child shipments to move onto this route. */
export class AddRouteShipmentsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    uniqueItems: true,
    example: [ULID_EXAMPLE],
    description: 'ULIDs of CREATED child shipments. No duplicates.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUlid({ each: true })
  shipmentIds!: string[];
}
