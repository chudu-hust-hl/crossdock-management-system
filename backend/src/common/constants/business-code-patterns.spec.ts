import {
  ITEM_CODE_PATTERN,
  ROUTE_NUMBER_PATTERN,
  SHIPMENT_CODE_PATTERN,
  TASK_NUMBER_PATTERN,
} from './business-code-patterns';

describe('business code patterns', () => {
  it.each([
    ['item code', ITEM_CODE_PATTERN, 'T-0001-1026'],
    ['shipment code', SHIPMENT_CODE_PATTERN, 'S-0120-0126'],
    ['route number', ROUTE_NUMBER_PATTERN, 'R-0007-1226'],
    ['task number', TASK_NUMBER_PATTERN, '1024-1026'],
    ['counter above 9999', ITEM_CODE_PATTERN, 'T-10000-1026'],
  ])('accepts a valid %s', (_name, pattern, value) => {
    expect(pattern.test(value)).toBe(true);
  });

  it.each([
    ['T-1-1026', 'counter shorter than four digits'],
    ['T-0001-0026', 'month 00'],
    ['T-0001-1326', 'month 13'],
    ['T-0001-126', 'three-digit month-year'],
    ['T-0001-10260', 'five-digit month-year'],
    ['t-0001-1026', 'lower-case prefix'],
    ['T-0001-1026 ', 'trailing characters'],
  ])('rejects %s (%s)', (value) => {
    expect(ITEM_CODE_PATTERN.test(value)).toBe(false);
  });

  it('does not accept one prefix in place of another', () => {
    expect(ITEM_CODE_PATTERN.test('S-0001-1026')).toBe(false);
    expect(SHIPMENT_CODE_PATTERN.test('R-0001-1026')).toBe(false);
    expect(ROUTE_NUMBER_PATTERN.test('T-0001-1026')).toBe(false);
    expect(TASK_NUMBER_PATTERN.test('T-0001-1026')).toBe(false);
  });
});
