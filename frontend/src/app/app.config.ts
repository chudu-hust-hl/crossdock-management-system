import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The one HttpClient of the app, used by ApiService; it adds the bearer token.
    provideHttpClient(withInterceptors([authInterceptor])),
    // `{{ value | date }}` shows e.g. 2026-10-27 08:00, in the browser's time zone.
    {
      provide: DATE_PIPE_DEFAULT_OPTIONS,
      useValue: { dateFormat: 'yyyy-MM-dd HH:mm' },
    },
  ],
};
