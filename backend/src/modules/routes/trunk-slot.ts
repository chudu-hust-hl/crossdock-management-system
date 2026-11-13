import { RouteSlot } from './enums/route-slot.enum';

/** Asia/Ho_Chi_Minh is UTC+7 and does not observe daylight saving. */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface TrunkSlot {
  serviceDate: string;
  slot: RouteSlot;
  appointment: { from: Date; to: Date };
}

/**
 * The instant used to choose a dock–dock slot.
 * A namespace import lets a test replace this without freezing MongoDB timers.
 */
export function bookingNow(): Date {
  return new Date();
}

/** Morning before 12:00 Vietnam time; evening from 12:00, both on that calendar day. */
export function trunkSlotFor(bookedAt: Date): TrunkSlot {
  const vietnam = vietnamCalendar(bookedAt);
  const slot =
    vietnam.minutes < 12 * 60 ? RouteSlot.MORNING : RouteSlot.EVENING;
  return trunkSlot(vietnam.year, vietnam.month, vietnam.day, slot);
}

/**
 * The following window when the chosen one exists but is no longer `PLANNED`:
 * evening of the same day after morning, otherwise morning of the next day.
 */
export function nextTrunkSlot(current: TrunkSlot): TrunkSlot {
  const [year, month, day] = current.serviceDate.split('-').map(Number);
  if (current.slot === RouteSlot.MORNING) {
    return trunkSlot(year, month, day, RouteSlot.EVENING);
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return trunkSlot(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    RouteSlot.MORNING,
  );
}

function trunkSlot(
  year: number,
  month: number,
  day: number,
  slot: RouteSlot,
): TrunkSlot {
  const hours = slot === RouteSlot.MORNING ? [8, 12] : [18, 22];
  return {
    serviceDate: formatServiceDate(year, month, day),
    slot,
    appointment: {
      from: vietnamLocalTime(year, month, day, hours[0]),
      to: vietnamLocalTime(year, month, day, hours[1]),
    },
  };
}

function vietnamCalendar(date: Date): {
  year: number;
  month: number;
  day: number;
  minutes: number;
} {
  const shifted = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function formatServiceDate(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function vietnamLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, 0, 0, 0));
}
