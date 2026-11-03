import { Mongoose, Schema } from 'mongoose';
import { TimeWindowSchema } from './time-window.schema';

// TimeWindow is only ever embedded, so it is tested through a minimal host schema.
const HostModel = new Mongoose().model(
  'TimeWindowHost',
  new Schema({ window: { type: TimeWindowSchema, default: () => ({}) } }),
);

function validationErrorPaths(window: Record<string, unknown>): string[] {
  const error = new HostModel({ window }).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('TimeWindowSchema', () => {
  it('does not create an _id for the embedded window', () => {
    expect(TimeWindowSchema.path('_id')).toBeUndefined();
  });

  it('defaults both ends to null until they are known', () => {
    expect(new HostModel().toObject().window).toEqual({ from: null, to: null });
  });

  it('accepts open-ended and ordered windows', () => {
    expect(
      validationErrorPaths({ from: new Date('2026-10-18T08:00:00Z') }),
    ).toEqual([]);
    expect(
      validationErrorPaths({ to: new Date('2026-10-18T08:00:00Z') }),
    ).toEqual([]);
    expect(
      validationErrorPaths({
        from: new Date('2026-10-18T08:00:00Z'),
        to: new Date('2026-10-18T08:00:00Z'),
      }),
    ).toEqual([]);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      validationErrorPaths({
        from: new Date('2026-10-18T10:00:00Z'),
        to: new Date('2026-10-18T08:00:00Z'),
      }),
    ).toEqual(['window.from', 'window.to']);
  });
});
