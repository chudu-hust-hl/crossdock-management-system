import { containsIgnoringCase } from './text-filter.util';

describe('containsIgnoringCase', () => {
  it('matches any part of the text, ignoring case', () => {
    const pattern = containsIgnoringCase('cross-dock');

    expect(pattern.test('Hanoi CROSS-DOCK 1')).toBe(true);
    expect(pattern.test('Hanoi Store')).toBe(false);
  });

  it('matches regular-expression characters literally', () => {
    const pattern = containsIgnoringCase('A.B (1)');

    expect(pattern.test('Store A.B (1)')).toBe(true);
    expect(pattern.test('Store AxB 1')).toBe(false);
    expect(containsIgnoringCase('.*').test('anything')).toBe(false);
  });

  it('normalizes the input to NFC, the form names are stored in', () => {
    const decomposed = 'Nguye\u0302\u0303n';

    expect(containsIgnoringCase(decomposed).test('Nguyễn Văn A')).toBe(true);
  });
});
