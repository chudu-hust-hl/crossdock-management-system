import { ParamMap, Params } from '@angular/router';
import { ListQuery } from '../api/api.service';

/** Records per page on every list screen. */
export const PAGE_LIMIT = 20;

/**
 * A list screen keeps its filters and page in the URL (e.g. `/shipments?status=CREATED&page=2`),
 * so that reloading or going back shows the same list. This reads them as the API query.
 */
export function queryFromUrl(params: ParamMap, filters: readonly string[]): ListQuery {
  const query: ListQuery = {
    page: params.get('page') ?? undefined,
    limit: PAGE_LIMIT,
  };
  for (const name of filters) {
    query[name] = params.get(name) ?? undefined;
  }
  return query;
}

/**
 * The URL query parameters for a submitted filter form. Empty fields are removed
 * (`null`), and the list starts again at page 1.
 */
export function filtersFromForm(form: HTMLFormElement, filters: readonly string[]): Params {
  const data = new FormData(form);
  const params: Params = { page: null };
  for (const name of filters) {
    const value = String(data.get(name) ?? '').trim();
    params[name] = value === '' ? null : value;
  }
  return params;
}
