import { Transform, TransformFnParams } from 'class-transformer';

/**
 * Trims a string property before validation, so `@IsNotEmpty()` also rejects
 * whitespace-only values. Non-string values are left for the type validators.
 */
export function Trim(): PropertyDecorator {
  return Transform((params: TransformFnParams) => {
    const value: unknown = params.value;
    return typeof value === 'string' ? value.trim() : value;
  });
}
