import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** Request shape of the embedded `Address` (see `schemas/address.schema.ts`). */
export class AddressDto {
  @ApiProperty({ example: '1 Dai Co Viet' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  addressLine1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  ward?: string;

  @ApiPropertyOptional({ example: 'Hai Ba Trung' })
  @IsOptional()
  @Trim()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ example: 'Hanoi' })
  @IsOptional()
  @Trim()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  province?: string;

  @ApiProperty({
    description: 'Part of the store reuse rule.',
    example: '100000',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  postalCode!: string;

  @ApiPropertyOptional({ example: 'Vietnam' })
  @IsOptional()
  @Trim()
  @IsString()
  country?: string;
}
