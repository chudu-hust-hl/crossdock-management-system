import {
  LOCATION_IDENTITY_COLLATION,
  normalizeIdentityText,
} from '../locations/location-identity';

/** The province fields routing compares. `id` is the province code, not a ULID. */
export interface ProvinceRecord {
  id: string;
  name: {
    local?: string;
    en?: string;
    slug?: string;
  };
}

export type ProvinceMatch =
  | { kind: 'empty' }
  | { kind: 'none'; text: string }
  | { kind: 'ambiguous'; text: string }
  | { kind: 'matched'; text: string; province: ProvinceRecord };

/**
 * Compares one `address.province` string with the provinces collection.
 * Whitespace is normalized like a store identity field. Equality is
 * case-insensitive and diacritic-sensitive, the same distinction as
 * `LOCATION_IDENTITY_COLLATION` (locale `vi`, strength 2): `sensitivity:
 * 'accent'` ignores case and keeps accents.
 */
export function matchProvince(
  raw: string | undefined | null,
  provinces: readonly ProvinceRecord[],
): ProvinceMatch {
  if (raw == null) {
    return { kind: 'empty' };
  }
  const text = normalizeIdentityText(raw);
  if (text === '') {
    return { kind: 'empty' };
  }

  const matched = provinces.filter((province) =>
    comparableNames(province).some((name) => identityEquals(name, text)),
  );
  if (matched.length === 0) {
    return { kind: 'none', text };
  }
  if (matched.length > 1) {
    return { kind: 'ambiguous', text };
  }
  return { kind: 'matched', text, province: matched[0] };
}

/**
 * The three names a province may be matched on: `name.local`, `name.en`, and
 * the slug without its trailing `-<id>` (`ha-noi-01` is `ha-noi`).
 */
function comparableNames(province: ProvinceRecord): string[] {
  const slug = slugWithoutTrailingId(province.name.slug, province.id);
  return [province.name.local, province.name.en, slug].flatMap((name) => {
    if (name == null) {
      return [];
    }
    const normalized = normalizeIdentityText(name);
    return normalized === '' ? [] : [normalized];
  });
}

function slugWithoutTrailingId(
  slug: string | undefined,
  provinceId: string,
): string | undefined {
  if (slug == null || slug === '') {
    return undefined;
  }
  const suffix = `-${provinceId}`;
  return slug.endsWith(suffix) ? slug.slice(0, -suffix.length) : slug;
}

function identityEquals(left: string, right: string): boolean {
  return (
    normalizeIdentityText(left).localeCompare(
      normalizeIdentityText(right),
      LOCATION_IDENTITY_COLLATION.locale,
      { sensitivity: 'accent' },
    ) === 0
  );
}
