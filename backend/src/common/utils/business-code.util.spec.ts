import {
  ITEM_CODE_PATTERN,
  ROUTE_NUMBER_PATTERN,
  SHIPMENT_CODE_PATTERN,
  TASK_NUMBER_PATTERN,
} from '../constants/business-code-patterns';
import { BusinessCodeType } from '../enums/business-code-type.enum';
import { businessCodePeriod, formatBusinessCode } from './business-code.util';

describe('business code utility', () => {
  const october22 = new Date('2026-10-22T08:00:00Z');

  it.each([
    [BusinessCodeType.ITEM, 'T-0001-1026', ITEM_CODE_PATTERN],
    [BusinessCodeType.SHIPMENT, 'S-0001-1026', SHIPMENT_CODE_PATTERN],
    [BusinessCodeType.ROUTE, 'R-0001-1026', ROUTE_NUMBER_PATTERN],
    [BusinessCodeType.DOCK_TASK, '0001-1026', TASK_NUMBER_PATTERN],
  ])(
    'formats a %s code that matches its schema pattern',
    (type, code, pattern) => {
      expect(formatBusinessCode(type, 1, october22)).toBe(code);
      expect(pattern.test(code)).toBe(true);
    },
  );

  it('pads the counter to four digits and lets it grow beyond 9999', () => {
    expect(formatBusinessCode(BusinessCodeType.ITEM, 42, october22)).toBe(
      'T-0042-1026',
    );
    expect(formatBusinessCode(BusinessCodeType.ITEM, 10000, october22)).toBe(
      'T-10000-1026',
    );
  });

  it('rejects a counter that is not a positive integer', () => {
    for (const counter of [0, -1, 1.5]) {
      expect(() =>
        formatBusinessCode(BusinessCodeType.ITEM, counter, october22),
      ).toThrow(RangeError);
    }
  });

  it('determines the month in Vietnam time (UTC+7)', () => {
    expect(businessCodePeriod(new Date('2026-10-31T16:59:59Z'))).toBe('1026');
    expect(businessCodePeriod(new Date('2026-10-31T17:00:00Z'))).toBe('1126');
    expect(businessCodePeriod(new Date('2026-12-31T17:00:00Z'))).toBe('0127');
  });
});
