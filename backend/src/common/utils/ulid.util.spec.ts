import { generateUlid, isValidUlid, ulidValidator } from './ulid.util';

describe('ulid.util', () => {
  it('generates a 26-character Crockford Base32 ULID', () => {
    const id = generateUlid();

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isValidUlid(id)).toBe(true);
  });

  it('generates a different ULID on each call', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUlid()));

    expect(ids.size).toBe(1000);
  });

  it('ignores arguments passed by Mongoose default functions', () => {
    const callAsMongooseDefault = generateUlid as (doc: unknown) => string;

    expect(isValidUlid(callAsMongooseDefault({ some: 'document' }))).toBe(true);
  });

  it('validates ULID strings', () => {
    expect(isValidUlid('01M4GVJ9TMCR0DTRTXG3JHTPHS')).toBe(true);
    expect(isValidUlid('not-a-ulid')).toBe(false);
    expect(isValidUlid('507f1f77bcf86cd799439011')).toBe(false);
  });

  it('accepts only the canonical upper-case form', () => {
    expect(isValidUlid('01m4gvj9tmcr0dtrtxg3jhtphs')).toBe(false);
  });

  describe('ulidValidator', () => {
    it('accepts a ULID and leaves missing values to `required`', () => {
      expect(ulidValidator.validator(generateUlid())).toBe(true);
      expect(ulidValidator.validator(null)).toBe(true);
      expect(ulidValidator.validator(undefined)).toBe(true);
    });

    it('rejects ObjectIds and non-strings', () => {
      expect(ulidValidator.validator('507f1f77bcf86cd799439011')).toBe(false);
      expect(ulidValidator.validator(42)).toBe(false);
    });
  });
});
