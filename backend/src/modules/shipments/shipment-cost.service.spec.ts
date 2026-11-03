import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig, PricingConfig } from '../../config/configuration';
import { WeightUnit } from '../items/enums/weight-unit.enum';
import {
  calculateShipmentCost,
  ShipmentCostService,
  toKilograms,
} from './shipment-cost.service';

const PRICING: PricingConfig = {
  baseFee: 20000,
  feePerItem: 5000,
  feePerKg: 3000,
};

function serviceWith(pricing: PricingConfig | null): ShipmentCostService {
  const config = { get: () => pricing } as unknown as ConfigService<
    AppConfig,
    true
  >;
  return new ShipmentCostService(config);
}

describe('shipment cost', () => {
  describe('calculateShipmentCost', () => {
    it('adds the base fee, a fee per item, and a fee per kilogram', () => {
      const cost = calculateShipmentCost(PRICING, [
        { weight: 2.5, weightUnit: WeightUnit.KG },
        { weight: 1, weightUnit: WeightUnit.KG },
      ]);

      // 20000 + 5000 × 2 + 3000 × 3.5
      expect(cost).toBe(40500);
    });

    it('converts pounds to kilograms', () => {
      expect(toKilograms(10, WeightUnit.LB)).toBeCloseTo(4.5359237, 10);
      expect(toKilograms(10, WeightUnit.KG)).toBe(10);

      // 20000 + 5000 + 3000 × 4.5359237 = 38607.7711
      expect(
        calculateShipmentCost(PRICING, [
          { weight: 10, weightUnit: WeightUnit.LB },
        ]),
      ).toBe(38608);
    });

    it('counts an item without a weight as 0 kg, but still as an item', () => {
      expect(calculateShipmentCost(PRICING, [{}, { weight: null }])).toBe(
        30000,
      );
    });

    it('rounds to whole VND', () => {
      expect(
        calculateShipmentCost({ baseFee: 0, feePerItem: 0, feePerKg: 1 }, [
          { weight: 0.4, weightUnit: WeightUnit.KG },
          { weight: 0.2, weightUnit: WeightUnit.KG },
        ]),
      ).toBe(1);
    });

    it('is deterministic and independent of item order', () => {
      const items = [
        { weight: 1.25, weightUnit: WeightUnit.LB },
        { weight: 7, weightUnit: WeightUnit.KG },
      ];

      expect(calculateShipmentCost(PRICING, items)).toBe(
        calculateShipmentCost(PRICING, [...items].reverse()),
      );
    });
  });

  describe('ShipmentCostService', () => {
    it('uses the configured rates', () => {
      expect(
        serviceWith(PRICING).calculate([
          { weight: 1, weightUnit: WeightUnit.KG },
        ]),
      ).toBe(28000);
    });

    it('answers 503 when pricing is not configured', () => {
      expect(() => serviceWith(null).calculate([])).toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
