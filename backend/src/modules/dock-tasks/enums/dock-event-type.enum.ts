/**
 * `type` of a dock event message (docs/scanning-flows.md §8). The three manual
 * values are also stored as a task's `metadata.reason`.
 */
export enum DockEventType {
  SCAN_INBOUND = 'SCAN_INBOUND',
  SCAN_OUTBOUND = 'SCAN_OUTBOUND',
  MANUAL_PICKUP = 'MANUAL_PICKUP',
  MANUAL_DELIVERY = 'MANUAL_DELIVERY',
  MISSING = 'MISSING',
}
