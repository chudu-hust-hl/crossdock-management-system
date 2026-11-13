/** Rates of the shipment cost formula (see `ShipmentCostService`), in VND. */
export interface PricingConfig {
  baseFee: number;
  feePerItem: number;
  feePerKg: number;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  mongodbUri: string;
  /** Browser origin allowed to call the API (CORS), e.g. the Angular dev server. */
  corsOrigin: string;
  /** `null` when no PRICING_* variable is set; shipments cannot be booked then. */
  pricing: PricingConfig | null;
}

const PRICING_VARIABLES = {
  baseFee: 'PRICING_BASE_FEE',
  feePerItem: 'PRICING_FEE_PER_ITEM',
  feePerKg: 'PRICING_FEE_PER_KG',
} as const;

export default function configuration(): AppConfig {
  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri) {
    throw new Error(
      'MONGODB_URI is not set. Copy backend/.env.example to backend/.env or set the variable in the environment.',
    );
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `PORT must be a positive integer, received "${process.env.PORT}".`,
    );
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
    mongodbUri,
    corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:4200',
    pricing: pricingConfiguration(),
  };
}

/**
 * The rates are business values, so the code has no defaults for them. Either none
 * is set (pricing disabled) or all three are set to non-negative numbers.
 */
function pricingConfiguration(): PricingConfig | null {
  const names = Object.values(PRICING_VARIABLES);
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length === names.length) {
    return null;
  }
  if (missing.length > 0) {
    throw new Error(
      `Set all of ${names.join(', ')} or none of them; missing: ${missing.join(', ')}.`,
    );
  }

  const rate = (name: string): number => {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `${name} must be a non-negative number, received "${process.env[name]}".`,
      );
    }
    return value;
  };
  return {
    baseFee: rate(PRICING_VARIABLES.baseFee),
    feePerItem: rate(PRICING_VARIABLES.feePerItem),
    feePerKg: rate(PRICING_VARIABLES.feePerKg),
  };
}
