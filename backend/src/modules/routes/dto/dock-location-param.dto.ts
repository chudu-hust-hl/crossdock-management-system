import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';

/** `:locationId` of `GET /docks/:locationId/routes`. */
export class DockLocationParamDto {
  @ApiProperty({
    description: 'Public ULID of a cross-dock Location.',
    example: '01M5HJ2FXJ9RYWMT6YT7YX9KH7',
  })
  @IsUlid()
  locationId!: string;
}
