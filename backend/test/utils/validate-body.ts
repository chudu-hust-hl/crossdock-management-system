import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../src/config/validation.config';

const pipe = new ValidationPipe(validationPipeOptions);

/**
 * Runs a request body through the same ValidationPipe configuration the app uses.
 * Returns the transformed DTO, or the validation messages a client would receive.
 */
export async function validateBody<T>(
  dto: Type<T>,
  body: unknown,
): Promise<{ value?: T; errors: string[] }> {
  try {
    const value = (await pipe.transform(body, {
      type: 'body',
      metatype: dto,
    })) as T;
    return { value, errors: [] };
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    const response = error.getResponse() as { message: string[] };
    return { errors: response.message };
  }
}
