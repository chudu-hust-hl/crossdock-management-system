import { ApiProperty } from '@nestjs/swagger';

/** One CREATED child that may be moved onto this route. */
export class RouteCandidateResponse {
  @ApiProperty({ description: 'Public ULID of the child shipment.' })
  id!: string;

  @ApiProperty({ example: 'S-0002-1126' })
  code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Code of the root shipment.',
    example: 'S-0001-1126',
  })
  parentCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The root shipment's customer name.",
  })
  customerName!: string | null;

  @ApiProperty({ description: 'Number of items on this child.' })
  itemCount!: number;
}
