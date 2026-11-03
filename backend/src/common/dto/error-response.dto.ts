import { ApiProperty } from '@nestjs/swagger';

/** Nest's default error body, used only to document error responses in Swagger. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    description:
      'One message, or a list of validation messages for a `400` response.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['name should not be empty'],
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}
