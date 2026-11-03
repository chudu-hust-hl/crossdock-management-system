import { isValid, ulid } from 'ulid';

/**
 * Generates the public ULID `id` of a domain entity,
 * e.g. `@Prop({ default: generateUlid })` in a Mongoose schema.
 *
 * Takes no arguments on purpose: Mongoose may call `default` functions with the
 * document as the first argument, which `ulid()` would treat as a seed time.
 */
export function generateUlid(): string {
  return ulid();
}

/**
 * Only the canonical upper-case form is accepted: references are matched against
 * `id` as exact strings, so a lower-case ULID would never find its document.
 */
export function isValidUlid(value: string): boolean {
  return isValid(value) && value === value.toUpperCase();
}

/**
 * Mongoose `validate` option for every field that holds a ULID: the public `id`
 * and all references to other documents. Missing or `null` values pass here;
 * `required` decides whether a value must be present.
 */
export const ulidValidator = {
  validator: (value: unknown): boolean =>
    value == null || (typeof value === 'string' && isValidUlid(value)),
  message: '`{VALUE}` is not a valid ULID',
};
