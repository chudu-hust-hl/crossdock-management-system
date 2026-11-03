import { BusinessCodeType } from '../enums/business-code-type.enum';

const PREFIXES: Record<BusinessCodeType, string> = {
  [BusinessCodeType.ITEM]: 'T-',
  [BusinessCodeType.SHIPMENT]: 'S-',
  [BusinessCodeType.ROUTE]: 'R-',
  [BusinessCodeType.DOCK_TASK]: '',
};

/** Vietnam time (UTC+7) has no daylight saving, so a fixed offset is exact. */
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The `MMYY` period a date belongs to, in Vietnam time.
 * Counters restart whenever this value changes.
 */
export function businessCodePeriod(date: Date): string {
  const vietnamTime = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const year = String(vietnamTime.getUTCFullYear() % 100).padStart(2, '0');
  return `${month}${year}`;
}

/** Builds a business code, e.g. `(ITEM, 1, 2026-10-22)` → `T-0001-1026`. */
export function formatBusinessCode(
  type: BusinessCodeType,
  counter: number,
  date: Date,
): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`Counter must be a positive integer, got ${counter}`);
  }
  const paddedCounter = String(counter).padStart(4, '0');
  return `${PREFIXES[type]}${paddedCounter}-${businessCodePeriod(date)}`;
}
