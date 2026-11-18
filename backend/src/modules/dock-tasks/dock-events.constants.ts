import { DockEventType } from './enums/dock-event-type.enum';

/** RabbitMQ names of docs/scanning-flows.md §8. Declared only by `RabbitMqService`. */
export const EVENTS_EXCHANGE = 'crossdock.events';
export const DEAD_LETTER_EXCHANGE = 'crossdock.dlx';
export const ROLLUP_QUEUE = 'crossdock.rollup';
export const ROLLUP_DEAD_LETTER_QUEUE = 'crossdock.rollup.dlq';
export const ROLLUP_FAILED_ROUTING_KEY = 'crossdock.rollup.failed';

export const ROUTING_KEYS = {
  pickupConfirmed: 'route.pickup.confirmed',
  scanCompleted: 'dock.scan.completed',
  itemMissing: 'dock.item.missing',
  deliveryConfirmed: 'route.delivery.confirmed',
} as const;

/** Each message type is published with one routing key. */
export const ROUTING_KEY_OF: Record<DockEventType, string> = {
  [DockEventType.MANUAL_PICKUP]: ROUTING_KEYS.pickupConfirmed,
  [DockEventType.SCAN_INBOUND]: ROUTING_KEYS.scanCompleted,
  [DockEventType.SCAN_OUTBOUND]: ROUTING_KEYS.scanCompleted,
  [DockEventType.MISSING]: ROUTING_KEYS.itemMissing,
  [DockEventType.MANUAL_DELIVERY]: ROUTING_KEYS.deliveryConfirmed,
};

/** Header counting how often the rollup of a message has failed. */
export const RETRY_HEADER = 'x-retry';
/** After this many failed rollups the message goes to the dead-letter queue. */
export const MAX_ROLLUP_ATTEMPTS = 3;

/** `errorCode` of the EXCEPTION task written by "mark missing". */
export const MISSING_ERROR_CODE = 'MISSING';
