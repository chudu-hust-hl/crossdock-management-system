import { catchError, map, Observable, of, startWith } from 'rxjs';
import { errorMessage } from './api.service';

/** What a page shows for one request: a loading text, the data, or the error. */
export type LoadState<T> =
  { status: 'loading' } | { status: 'loaded'; data: T } | { status: 'error'; message: string };

export const LOADING: LoadState<never> = { status: 'loading' };

/** Turns a request into its states: first `loading`, then `loaded` or `error`. */
export function load<T>(request: Observable<T>): Observable<LoadState<T>> {
  return request.pipe(
    map((data): LoadState<T> => ({ status: 'loaded', data })),
    catchError((error: unknown) =>
      of<LoadState<T>>({ status: 'error', message: errorMessage(error) }),
    ),
    startWith<LoadState<T>>(LOADING),
  );
}
