import { isValidUlid } from '../../common/utils/ulid.util';
import { DockEventType } from './enums/dock-event-type.enum';

/** The JSON body of every dock event (docs/scanning-flows.md §8): ids only. */
export interface DockEvent {
  /** A new ULID per message, for the log line. Not stored. */
  eventId: string;
  /** ISO 8601. */
  occurredAt: string;
  type: DockEventType;
  routeId: string;
  locationId: string;
  itemIds: string[];
  taskIds: string[];
}

/** What a dock action and the rollup need; the publisher adds `eventId` and `occurredAt`. */
export type DockEventFields = Omit<DockEvent, 'eventId' | 'occurredAt'>;

/** Reads a message body. A body that is not a dock event throws, like a failed rollup. */
export function parseDockEvent(content: Buffer): DockEventFields {
  const body = JSON.parse(content.toString('utf8')) as Partial<DockEvent>;
  const isIdList = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && isValidUlid(id));
  if (
    !Object.values(DockEventType).includes(body.type as DockEventType) ||
    typeof body.routeId !== 'string' ||
    !isValidUlid(body.routeId) ||
    typeof body.locationId !== 'string' ||
    !isValidUlid(body.locationId) ||
    !isIdList(body.itemIds) ||
    !isIdList(body.taskIds)
  ) {
    throw new Error(`Not a dock event: ${content.toString('utf8')}`);
  }
  return {
    type: body.type as DockEventType,
    routeId: body.routeId,
    locationId: body.locationId,
    itemIds: body.itemIds,
    taskIds: body.taskIds,
  };
}
