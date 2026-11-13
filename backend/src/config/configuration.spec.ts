import configuration from './configuration';

const PRICING_VARIABLES = [
  'PRICING_BASE_FEE',
  'PRICING_FEE_PER_ITEM',
  'PRICING_FEE_PER_KG',
];

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, MONGODB_URI: 'mongodb://localhost/test' };
    for (const name of PRICING_VARIABLES) {
      delete process.env[name];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows the Angular dev server origin by default', () => {
    delete process.env.CORS_ORIGIN;
    expect(configuration().corsOrigin).toBe('http://localhost:4200');

    process.env.CORS_ORIGIN = 'http://localhost:4300';
    expect(configuration().corsOrigin).toBe('http://localhost:4300');
  });

  it('disables pricing when no PRICING_* variable is set', () => {
    expect(configuration().pricing).toBeNull();
  });

  it('reads all three pricing rates', () => {
    process.env.PRICING_BASE_FEE = '20000';
    process.env.PRICING_FEE_PER_ITEM = '0';
    process.env.PRICING_FEE_PER_KG = '2500.5';

    expect(configuration().pricing).toEqual({
      baseFee: 20000,
      feePerItem: 0,
      feePerKg: 2500.5,
    });
  });

  it('fails at startup when only some rates are set', () => {
    process.env.PRICING_BASE_FEE = '20000';

    expect(() => configuration()).toThrow(
      'missing: PRICING_FEE_PER_ITEM, PRICING_FEE_PER_KG',
    );
  });

  it.each(['-1', 'abc', 'Infinity'])(
    'fails at startup for the invalid rate "%s"',
    (value) => {
      process.env.PRICING_BASE_FEE = value;
      process.env.PRICING_FEE_PER_ITEM = '0';
      process.env.PRICING_FEE_PER_KG = '0';

      expect(() => configuration()).toThrow(
        'PRICING_BASE_FEE must be a non-negative number',
      );
    },
  );

  it('still requires MONGODB_URI', () => {
    delete process.env.MONGODB_URI;

    expect(() => configuration()).toThrow('MONGODB_URI is not set');
  });
});
