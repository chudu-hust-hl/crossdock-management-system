import { Routes } from '@angular/router';
import { ShipmentDetail } from './shipment-detail';
import { ShipmentList } from './shipment-list';

export const SHIPMENT_ROUTES: Routes = [
  { path: '', component: ShipmentList, title: 'Shipments' },
  { path: ':id', component: ShipmentDetail, title: 'Shipment' },
];
