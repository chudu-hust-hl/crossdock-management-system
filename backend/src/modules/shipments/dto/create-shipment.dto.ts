import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { CreateItemDto } from '../../items/dto/create-item.dto';
import { ShipmentEndpointDto } from './shipment-endpoint.dto';

/**
 * Booking request: who books, the two endpoints, and the shipment's items. Every
 * item is new: a booking never references or reuses an existing Item.
 * `code`, `cost`, `status`, `parentId`, `itemIds`, and `deliveryInfos` are not
 * accepted; the booking workflow derives them (docs/business-workflows.md).
 */
export class CreateShipmentDto {
  @ApiProperty({ example: 'Cong ty TNHH ABC' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiProperty({ type: ShipmentEndpointDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShipmentEndpointDto)
  pickup!: ShipmentEndpointDto;

  @ApiProperty({ type: ShipmentEndpointDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShipmentEndpointDto)
  dropoff!: ShipmentEndpointDto;

  @ApiProperty({
    type: [CreateItemDto],
    description:
      'At least one new physical item. Each becomes a new Item at the pickup Location; barcodes must be unique.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateItemDto)
  @ArrayUnique((item: CreateItemDto) => item.barcode, {
    message: 'Each item in items must have a different barcode',
  })
  items!: CreateItemDto[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
