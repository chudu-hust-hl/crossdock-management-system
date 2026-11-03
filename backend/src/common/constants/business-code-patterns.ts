/**
 * Business codes are `<counter>-MMYY`: a counter of at least four digits
 * (zero-padded, restarting every month) followed by the month 01–12 and the
 * two-digit year, e.g. `T-0001-1026` is the first item code of October 2026.
 */
const COUNTER = '[0-9]{4,}';
const MONTH_YEAR = '(?:0[1-9]|1[0-2])[0-9]{2}';

/** Item code, e.g. `T-0001-1026`. */
export const ITEM_CODE_PATTERN = new RegExp(`^T-${COUNTER}-${MONTH_YEAR}$`);

/** Shipment code, e.g. `S-0120-1026`. */
export const SHIPMENT_CODE_PATTERN = new RegExp(`^S-${COUNTER}-${MONTH_YEAR}$`);

/** Route number, e.g. `R-0007-1026`. */
export const ROUTE_NUMBER_PATTERN = new RegExp(`^R-${COUNTER}-${MONTH_YEAR}$`);

/** Dock task number, e.g. `1024-1026`. */
export const TASK_NUMBER_PATTERN = new RegExp(`^${COUNTER}-${MONTH_YEAR}$`);
