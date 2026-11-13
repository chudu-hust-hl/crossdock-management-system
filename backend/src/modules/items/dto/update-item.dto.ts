import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { ItemUnit } from '../enums/item-unit.enum';
import { WeightUnit } from '../enums/weight-unit.enum';
import { DimensionsDto } from './dimensions.dto';

/** Validates a property that was sent, including `null`, and skips one that was not. */
const IF_SENT = (_dto: object, value: unknown) => value !== undefined;

/**
 * Correction of a booked item (`PUT /shipments/:id/items/:itemId`). Every field is
 * optional; a field that is not sent keeps its value. `barcode`, `itemCode`, `status`
 * and the current location/shipment cannot be changed here.
 */
export class UpdateItemDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '`null` removes the description.',
    example: 'Carton of books',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  description?: string | null;

  @ApiPropertyOptional({ enum: ItemUnit, enumName: 'ItemUnit' })
  @ValidateIf(IF_SENT)
  @IsEnum(ItemUnit)
  itemUnit?: ItemUnit;

  @ApiPropertyOptional({
    example: 2.5,
    description: 'Positive; `weightUnit` is required with it.',
  })
  @ValidateIf(IF_SENT)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  weight?: number;

  @ApiPropertyOptional({ enum: WeightUnit, enumName: 'WeightUnit' })
  @ValidateIf(
    (dto: UpdateItemDto, value: unknown) =>
      value !== undefined || dto.weight !== undefined,
  )
  @IsEnum(WeightUnit)
  weightUnit?: WeightUnit;

  @ApiPropertyOptional({ type: DimensionsDto })
  @ValidateIf(IF_SENT)
  @IsObject()
  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions?: DimensionsDto;
}
