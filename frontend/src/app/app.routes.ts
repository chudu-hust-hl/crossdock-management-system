import { Routes } from '@angular/router';
import { loggedInGuard } from './auth/logged-in.guard';

/** One route per feature. Each feature defines its own list and detail routes. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'shipments' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login').then((m) => m.Login),
    title: 'Log in',
  },
  {
    path: 'shipments',
    canActivate: [loggedInGuard],
    loadChildren: () => import('./shipments/shipments.routes').then((m) => m.SHIPMENT_ROUTES),
  },
  {
    path: 'routes',
    canActivate: [loggedInGuard],
    loadChildren: () => import('./routes/routes.routes').then((m) => m.ROUTE_ROUTES),
  },
  {
    path: 'locations',
    canActivate: [loggedInGuard],
    loadChildren: () => import('./locations/locations.routes').then((m) => m.LOCATION_ROUTES),
  },
  { path: '**', redirectTo: 'shipments' },
];
