import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { DimensionUnit } from '../enums/dimension-unit.enum';

/** Request shape of the embedded `Dimensions` (see `schemas/dimensions.schema.ts`). */
export class DimensionsDto {
  @ApiProperty({ example: 40 })
  @IsNumber()
  @IsPositive()
  length!: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @IsPositive()
  width!: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @IsPositive()
  height!: number;

  @ApiProperty({ enum: DimensionUnit, enumName: 'DimensionUnit' })
  @IsEnum(DimensionUnit)
  unit!: DimensionUnit;
}
