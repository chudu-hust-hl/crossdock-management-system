import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { ItemUnit } from '../enums/item-unit.enum';
import { WeightUnit } from '../enums/weight-unit.enum';
import { DimensionsDto } from './dimensions.dto';

/**
 * A new physical item supplied with a booking; every booking creates its own Items.
 * `id`, `itemCode`, `status`, and the current location/shipment are set by the system.
 * `weight` is required because the shipment cost depends on it.
 */
export class CreateItemDto {
  @ApiProperty({
    description: 'Value printed on the label; unique across all items.',
    example: '8934567890123',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  barcode!: string;

  @ApiPropertyOptional({ example: 'Carton of books' })
  @IsOptional()
  @Trim()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ItemUnit, enumName: 'ItemUnit', example: ItemUnit.BOX })
  @IsEnum(ItemUnit)
  itemUnit!: ItemUnit;

  @ApiProperty({ example: 2.5 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  weight!: number;

  @ApiProperty({ enum: WeightUnit, enumName: 'WeightUnit' })
  @IsEnum(WeightUnit)
  weightUnit!: WeightUnit;

  @ApiPropertyOptional({ type: DimensionsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions?: DimensionsDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
