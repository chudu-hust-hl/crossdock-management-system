import { Routes } from '@angular/router';

/** One route per feature; each feature defines its list and detail routes. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'shipments' },
  {
    path: 'shipments',
    loadChildren: () => import('./shipments/shipments.routes').then((m) => m.SHIPMENT_ROUTES),
  },
  {
    path: 'locations',
    loadChildren: () => import('./locations/locations.routes').then((m) => m.LOCATION_ROUTES),
  },
  { path: '**', redirectTo: 'shipments' },
];
