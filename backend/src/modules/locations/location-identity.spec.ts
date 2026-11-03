import { normalizeIdentityText } from './location-identity';

describe('normalizeIdentityText', () => {
  it('trims and collapses inner whitespace, including tabs and line breaks', () => {
    expect(normalizeIdentityText('  Store \t  A\n ')).toBe('Store A');
  });

  it('keeps letter case and diacritics', () => {
    expect(normalizeIdentityText('Cửa Hàng  ABC')).toBe('Cửa Hàng ABC');
  });

  it('stores composed and decomposed Vietnamese text identically', () => {
    const decomposed = 'Nguye\u0302\u0303n';

    expect(normalizeIdentityText(decomposed)).toBe('Nguyễn');
  });
});
