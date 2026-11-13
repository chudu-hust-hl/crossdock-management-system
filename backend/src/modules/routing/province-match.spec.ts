import { matchProvince, ProvinceRecord } from './province-match';

const hanoi: ProvinceRecord = {
  id: '01',
  name: { local: 'Hà Nội', en: 'Hanoi', slug: 'ha-noi-01' },
};

const hoChiMinh: ProvinceRecord = {
  id: '79',
  name: {
    local: 'Hồ Chí Minh',
    en: 'Ho Chi Minh City',
    slug: 'ho-chi-minh-79',
  },
};

const provinces = [hanoi, hoChiMinh];

describe('matchProvince', () => {
  it('matches name.en, name.local, or the slug without its trailing id', () => {
    expect(matchProvince('Hanoi', provinces)).toMatchObject({
      kind: 'matched',
      province: { id: '01' },
    });
    expect(matchProvince('Hà Nội', provinces)).toMatchObject({
      kind: 'matched',
      province: { id: '01' },
    });
    expect(matchProvince('ha-noi', provinces)).toMatchObject({
      kind: 'matched',
      province: { id: '01' },
    });
    expect(matchProvince('ho-chi-minh', provinces)).toMatchObject({
      kind: 'matched',
      province: { id: '79' },
    });
  });

  it('ignores case and extra whitespace, and keeps diacritics', () => {
    expect(matchProvince('  hAnOi  ', provinces).kind).toBe('matched');
    expect(matchProvince('Ha-Noi', provinces)).toMatchObject({
      kind: 'matched',
      province: { id: '01' },
    });
    expect(matchProvince('Ha Noi', provinces)).toEqual({
      kind: 'none',
      text: 'Ha Noi',
    });
    expect(matchProvince('ha-noi-01', provinces)).toEqual({
      kind: 'none',
      text: 'ha-noi-01',
    });
  });

  it('treats a blank province as missing, and more than one province as ambiguous', () => {
    expect(matchProvince(undefined, provinces)).toEqual({ kind: 'empty' });
    expect(matchProvince('   ', provinces)).toEqual({ kind: 'empty' });
    expect(
      matchProvince('Hanoi', [
        hanoi,
        { id: '99', name: { local: 'Elsewhere', en: 'Hanoi', slug: 'x-99' } },
      ]),
    ).toMatchObject({ kind: 'ambiguous', text: 'Hanoi' });
  });

  it('counts a province once when the text matches more than one of its names', () => {
    const both = {
      id: '01',
      name: { local: 'Hanoi', en: 'Hanoi', slug: 'hanoi-01' },
    };

    expect(matchProvince('Hanoi', [both, hoChiMinh])).toMatchObject({
      kind: 'matched',
      province: { id: '01' },
    });
  });
});
