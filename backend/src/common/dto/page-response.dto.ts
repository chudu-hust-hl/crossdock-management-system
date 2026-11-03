import { ApiProperty } from '@nestjs/swagger';

/** Paging fields of every list response; each module's page class adds `items`. */
export class PageResponse {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({
    example: 42,
    description: 'Number of matching records on all pages.',
  })
  total!: number;
}
