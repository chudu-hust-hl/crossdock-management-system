import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../decorators/is-ulid.decorator';

/** Route parameters of `/<resource>/:id`, where `id` is the public ULID. */
export class UlidParamDto {
  @ApiProperty({
    description: 'Public ULID of the resource.',
    example: '01M5HJ2FXJ9RYWMT6YT7YX9KH7',
  })
  @IsUlid()
  id!: string;
}
