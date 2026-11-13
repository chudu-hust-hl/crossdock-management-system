import { Routes } from '@angular/router';
import { LocationDetail } from './location-detail';
import { LocationList } from './location-list';

export const LOCATION_ROUTES: Routes = [
  { path: '', component: LocationList, title: 'Locations' },
  { path: ':id', component: LocationDetail, title: 'Location' },
];
