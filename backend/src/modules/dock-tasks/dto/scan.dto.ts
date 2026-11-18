import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsUlid } from '../../../common/decorators/is-ulid.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** The text fields of `POST /dock-tasks/scan` (multipart/form-data). */
export class ScanDto {
  @ApiProperty({
    description: 'ULID of the route arriving at or leaving the dock.',
  })
  @IsUlid()
  routeId!: string;

  @ApiProperty({
    description: 'ULID of the dock Location where the scan happens.',
  })
  @IsUlid()
  locationId!: string;

  @ApiProperty({ example: '8930000000017' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  barcode!: string;
}

/** The whole form, for Swagger only: the photo is read by the file interceptor. */
export class ScanFormDto extends ScanDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Required proof photo, image/jpeg or image/png.',
  })
  photo!: unknown;
}

/** The uploaded photo, as the file interceptor (multer, memory storage) gives it. */
export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
