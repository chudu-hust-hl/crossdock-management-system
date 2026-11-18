import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** `POST /dock-tasks/missing`: one expected item at one stop of a route. */
export class MarkMissingDto {
  @ApiProperty({ description: 'ULID of the route.' })
  @IsUlid()
  routeId!: string;

  @ApiProperty({
    description: 'ULID of the stop Location where the item is missing.',
  })
  @IsUlid()
  locationId!: string;

  @ApiProperty({ description: 'ULID of the Item.' })
  @IsUlid()
  itemId!: string;

  @ApiProperty({
    description: 'Short operator note, stored as the task `errorMessage`.',
    example: 'Not on the truck when it was unloaded',
    maxLength: 500,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
