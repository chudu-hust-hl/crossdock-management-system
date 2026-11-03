import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';
import { isValidUlid } from '../utils/ulid.util';

/** Validates a public ULID identifier (use `{ each: true }` for arrays). */
export function IsUlid(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isUlid',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidUlid(value),
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be a ULID`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
