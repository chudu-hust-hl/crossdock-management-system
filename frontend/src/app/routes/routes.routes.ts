import { Routes } from '@angular/router';
import { RouteDetail } from './route-detail';
import { RouteList } from './route-list';

export const ROUTE_ROUTES: Routes = [
  { path: '', component: RouteList, title: 'Routes' },
  { path: ':id', component: RouteDetail, title: 'Route' },
];
