import { RouteSlot } from './enums/route-slot.enum';
import { nextTrunkSlot, trunkSlotFor } from './trunk-slot';

describe('trunkSlotFor', () => {
  it('uses the Vietnam calendar day and morning before 12:00', () => {
    const slot = trunkSlotFor(new Date('2026-11-06T17:30:00.000Z'));

    expect(slot.serviceDate).toBe('2026-11-07');
    expect(slot.slot).toBe(RouteSlot.MORNING);
    expect(slot.appointment).toEqual({
      from: new Date('2026-11-07T01:00:00.000Z'),
      to: new Date('2026-11-07T05:00:00.000Z'),
    });
  });

  it('uses the evening window from 12:00 Vietnam time', () => {
    const slot = trunkSlotFor(new Date('2026-11-07T05:00:00.000Z'));

    expect(slot).toEqual({
      serviceDate: '2026-11-07',
      slot: RouteSlot.EVENING,
      appointment: {
        from: new Date('2026-11-07T11:00:00.000Z'),
        to: new Date('2026-11-07T15:00:00.000Z'),
      },
    });
  });

  it('moves from a taken morning to the evening, then to the next morning', () => {
    const morning = trunkSlotFor(new Date('2026-11-07T02:00:00.000Z'));
    const evening = nextTrunkSlot(morning);
    const nextMorning = nextTrunkSlot(evening);

    expect(evening.serviceDate).toBe('2026-11-07');
    expect(evening.slot).toBe(RouteSlot.EVENING);
    expect(nextMorning).toMatchObject({
      serviceDate: '2026-11-08',
      slot: RouteSlot.MORNING,
    });
  });
});
