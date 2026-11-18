import { ApiProperty } from '@nestjs/swagger';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';

/** `POST /dock-tasks/pickup` and `POST /dock-tasks/delivery`: one whole route. */
export class RouteActionDto {
  @ApiProperty({
    description:
      'ULID of the store–dock (pickup) or dock–store (delivery) route.',
    example: '01M4GVJ9TMCR0DTRTXG3JHTPHS',
  })
  @IsUlid()
  routeId!: string;
}
