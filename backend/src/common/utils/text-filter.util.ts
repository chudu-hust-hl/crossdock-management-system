/**
 * A case-insensitive "contains" match for a text filter, e.g. `?name=hanoi`.
 * Regular-expression characters in the input are matched literally.
 */
export function containsIgnoringCase(text: string): RegExp {
  const escaped = text.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}
