import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemStatus } from '../enums/item-status.enum';
import { ItemUnit } from '../enums/item-unit.enum';
import { WeightUnit } from '../enums/weight-unit.enum';
import { Dimensions } from '../schemas/dimensions.schema';
import { Item } from '../schemas/item.schema';
import { DimensionsDto } from './dimensions.dto';

/** An Item as returned by the API: public ULID `id`, no `_id` or `deletedAt`. */
export class ItemResponse {
  @ApiProperty({
    description: 'Public ULID.',
    example: '01M5HM0P9Q8R7S6T5V4W3X2Y1Z',
  })
  id!: string;

  @ApiProperty({ example: 'T-0001-1026' })
  itemCode!: string;

  @ApiProperty({ example: '8930000000017' })
  barcode!: string;

  @ApiPropertyOptional({ example: 'Carton of books' })
  description?: string;

  @ApiProperty({ enum: ItemUnit, enumName: 'ItemUnit' })
  itemUnit!: ItemUnit;

  @ApiPropertyOptional({ example: 2.5 })
  weight?: number;

  @ApiPropertyOptional({ enum: WeightUnit, enumName: 'WeightUnit' })
  weightUnit?: WeightUnit;

  @ApiPropertyOptional({ type: DimensionsDto })
  dimensions?: Dimensions;

  @ApiProperty({ enum: ItemStatus, enumName: 'ItemStatus' })
  status!: ItemStatus;

  @ApiPropertyOptional({ description: 'ULID of the Location where it is now.' })
  currentLocationId?: string;

  @ApiPropertyOptional({
    description: 'ULID of the Shipment currently carrying it.',
  })
  currentShipmentId?: string;
}

export function toItemResponse(item: Item): ItemResponse {
  return {
    id: item.id,
    itemCode: item.itemCode,
    barcode: item.barcode,
    description: item.description,
    itemUnit: item.itemUnit,
    weight: item.weight,
    weightUnit: item.weightUnit,
    dimensions: item.dimensions,
    status: item.status,
    currentLocationId: item.currentLocationId,
    currentShipmentId: item.currentShipmentId,
  };
}
