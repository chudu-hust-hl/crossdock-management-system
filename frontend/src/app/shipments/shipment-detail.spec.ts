import { fromLocalInput, itemUpdateFromForm, toLocalInput } from './shipment-detail';

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe('datetime-local values', () => {
  it('round-trips an ISO date-time through the browser time zone', () => {
    const iso = '2026-11-10T01:00:00.000Z';

    expect(toLocalInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('leaves an unknown time empty and an invalid one as typed', () => {
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBe('');
  });
});

describe('itemUpdateFromForm', () => {
  const base = { itemUnit: 'PALLET', weight: ' 11 ', weightUnit: 'KG', dimensionUnit: 'CM' };

  it('sends an empty description as null and leaves out empty dimensions', () => {
    expect(
      itemUpdateFromForm(
        formData({ ...base, description: '  ', length: '', width: '', height: '' }),
      ),
    ).toEqual({ description: null, itemUnit: 'PALLET', weight: 11, weightUnit: 'KG' });
  });

  it('sends the dimensions as soon as one of them is filled', () => {
    expect(
      itemUpdateFromForm(
        formData({ ...base, description: 'Paper', length: '120', width: '100', height: '' }),
      ),
    ).toEqual({
      description: 'Paper',
      itemUnit: 'PALLET',
      weight: 11,
      weightUnit: 'KG',
      dimensions: { length: 120, width: 100, height: 0, unit: 'CM' },
    });
  });
});
