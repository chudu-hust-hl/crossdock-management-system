import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { DockList } from './dock-list';
import { DockLocation } from './dock-location';
import { DockWork } from './dock-work';

/** A work page without `direction` goes back to that dock. */
const directionGuard: CanActivateFn = (route) => {
  const direction = route.queryParamMap.get('direction');
  if (direction === 'inbound' || direction === 'outbound') {
    return true;
  }
  return inject(Router).createUrlTree(['/docks', route.paramMap.get('locationId')]);
};

export const DOCK_ROUTES: Routes = [
  { path: '', component: DockList, title: 'Docks' },
  {
    path: ':locationId/routes/:routeId',
    canActivate: [directionGuard],
    component: DockWork,
    title: 'Dock work',
  },
  { path: ':locationId', component: DockLocation, title: 'Dock' },
];
