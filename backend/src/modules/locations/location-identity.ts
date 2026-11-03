import { mongo } from 'mongoose';

/**
 * How the three identity fields of a `STORE` (`name`, `contactName`,
 * `address.postalCode`) are compared: case-insensitive but accent-sensitive,
 * so `Store A` matches `STORE A`, while `Nguyễn` does not match `Nguyen`.
 * The unique index and the lookup query must use this same collation.
 */
export const LOCATION_IDENTITY_COLLATION: mongo.CollationOptions = {
  locale: 'vi',
  strength: 2,
};

/**
 * Normalizes an identity field before it is stored or compared: one Unicode form
 * (NFC), no outer whitespace, and inner whitespace collapsed to one space.
 * Letter case is kept for display; the collation ignores it.
 */
export function normalizeIdentityText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}
