import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig, PricingConfig } from '../../config/configuration';
import { WeightUnit } from '../items/enums/weight-unit.enum';

/** What the formula needs from an item; a missing weight counts as 0 kg. */
export interface CostItem {
  weight?: number | null;
  weightUnit?: WeightUnit | null;
}

/** Exact by definition of the international avoirdupois pound. */
const KILOGRAMS_PER_POUND = 0.45359237;

export function toKilograms(weight: number, unit: WeightUnit): number {
  return unit === WeightUnit.LB ? weight * KILOGRAMS_PER_POUND : weight;
}

/**
 * `cost = round(baseFee + feePerItem × itemCount + feePerKg × totalWeightKg)`, in whole VND.
 * Only data known at booking time is used: there are no distances or zones yet.
 */
export function calculateShipmentCost(
  pricing: PricingConfig,
  items: CostItem[],
): number {
  const totalWeightKg = items.reduce(
    (sum, item) =>
      item.weight != null && item.weightUnit != null
        ? sum + toKilograms(item.weight, item.weightUnit)
        : sum,
    0,
  );
  return Math.round(
    pricing.baseFee +
      pricing.feePerItem * items.length +
      pricing.feePerKg * totalWeightKg,
  );
}

@Injectable()
export class ShipmentCostService {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /** Throws `503` when the PRICING_* rates are not configured. */
  calculate(items: CostItem[]): number {
    const pricing = this.configService.get('pricing', { infer: true });
    if (!pricing) {
      throw new ServiceUnavailableException(
        'Shipment pricing is not configured: set PRICING_BASE_FEE, PRICING_FEE_PER_ITEM and PRICING_FEE_PER_KG',
      );
    }
    return calculateShipmentCost(pricing, items);
  }
}
