import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';

/** Pages of the admin app open only while logged in; otherwise the login page, then back. */
export const loggedInGuard: CanActivateFn = (_route, state) => {
  if (inject(Session).isLoggedIn()) {
    return true;
  }
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
