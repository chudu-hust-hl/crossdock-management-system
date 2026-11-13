import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { Session } from './session';

/**
 * Sends `Authorization: Bearer <token>` with every request to the API while logged in.
 * A 401 on such a request means the token is no longer accepted, so the session ends.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(Session);
  const router = inject(Router);
  const token = request.url.startsWith(environment.apiBaseUrl) ? session.token() : null;
  const sent = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(sent).pipe(
    catchError((error: unknown) => {
      if (token && error instanceof HttpErrorResponse && error.status === 401) {
        session.end(router.url);
      }
      return throwError(() => error);
    }),
  );
};
