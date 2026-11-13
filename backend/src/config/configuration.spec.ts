import configuration from './configuration';

const PRICING_VARIABLES = [
  'PRICING_BASE_FEE',
  'PRICING_FEE_PER_ITEM',
  'PRICING_FEE_PER_KG',
];

const AUTH_SEED_VARIABLES = [
  'AUTH_SEED_EMAIL',
  'AUTH_SEED_PASSWORD',
  'AUTH_SEED_NAME',
];

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MONGODB_URI: 'mongodb://localhost/test',
      JWT_SECRET: 'unit-test-secret',
    };
    for (const name of [...PRICING_VARIABLES, ...AUTH_SEED_VARIABLES]) {
      delete process.env[name];
    }
  });

  it.each([undefined, '', '   '])(
    'fails at startup, naming JWT_SECRET, when it is %j',
    (value) => {
      if (value === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = value;
      }

      expect(() => configuration()).toThrow('JWT_SECRET is not set');
    },
  );

  it('reads JWT_SECRET', () => {
    expect(configuration().jwtSecret).toBe('unit-test-secret');
  });

  it('has no seed user unless all three AUTH_SEED_* variables are set', () => {
    expect(configuration().authSeed).toBeNull();

    process.env.AUTH_SEED_EMAIL = 'root@example.com';
    process.env.AUTH_SEED_PASSWORD = 'seed password';
    expect(configuration().authSeed).toBeNull();

    process.env.AUTH_SEED_NAME = ' Root Admin ';
    expect(configuration().authSeed).toEqual({
      email: 'root@example.com',
      password: 'seed password',
      fullName: 'Root Admin',
    });
  });

  it('fails at startup when the seed password is shorter than 8 characters', () => {
    process.env.AUTH_SEED_EMAIL = 'root@example.com';
    process.env.AUTH_SEED_PASSWORD = 'short';
    process.env.AUTH_SEED_NAME = 'Root Admin';

    expect(() => configuration()).toThrow(
      'AUTH_SEED_PASSWORD must have at least 8 characters.',
    );
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
