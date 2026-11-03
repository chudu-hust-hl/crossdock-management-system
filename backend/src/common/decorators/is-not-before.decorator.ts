import {
  buildMessage,
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Checks that a date is not earlier than another date property of the same object,
 * e.g. `@IsNotBefore('from') to`. Passes when either value is not a valid date,
 * so `@IsDate()` reports that case instead.
 */
export function IsNotBefore(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotBefore',
      constraints: [property],
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const other = (args?.object as Record<string, unknown>)[property];
          if (!(value instanceof Date) || !(other instanceof Date)) {
            return true;
          }
          return value.getTime() >= other.getTime();
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must not be earlier than ${property}`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
