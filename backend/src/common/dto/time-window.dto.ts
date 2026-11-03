import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';
import { IsNotBefore } from '../decorators/is-not-before.decorator';

/** A planned `{ from, to }` window in a request. Both ends are ISO 8601 date-times. */
export class TimeWindowDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-27T08:00:00+07:00',
  })
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Must not be earlier than `from`.',
    example: '2026-10-27T10:00:00+07:00',
  })
  @Type(() => Date)
  @IsDate()
  @IsNotBefore('from')
  to!: Date;
}

/** A `{ from, to }` window in a response; an end is `null` until it is known. */
export class TimeWindowResponse {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  from!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  to!: Date | null;
}
