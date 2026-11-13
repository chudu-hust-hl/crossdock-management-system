import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { ShipmentSummary } from '../api/api.models';
import { itemsLine, ShipmentList } from './shipment-list';

function item(counter: number): ShipmentSummary['items'][number] {
  return {
    id: `ITEM${counter}`,
    itemCode: `T-000${counter}-1126`,
    itemUnit: 'BOX',
    weight: 2.5,
    weightUnit: 'KG',
  };
}

describe('itemsLine', () => {
  it('joins code, unit and weight of each item', () => {
    expect(itemsLine([item(1), { ...item(2), itemUnit: 'PALLET', weight: 120 }])).toBe(
      'T-0001-1126 · BOX · 2.5 KG, T-0002-1126 · PALLET · 120 KG',
    );
  });

  it('shows three items and counts the rest', () => {
    expect(itemsLine([1, 2, 3, 4, 5].map(item))).toBe(
      'T-0001-1126 · BOX · 2.5 KG, T-0002-1126 · BOX · 2.5 KG, T-0003-1126 · BOX · 2.5 KG +2',
    );
  });
});

describe('ShipmentList', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'shipments', component: ShipmentList }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('adds isRoot=true to the URL before it loads, keeping the other filters', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);

    await harness.navigateByUrl('/shipments?status=CREATED&isRoot=false');

    expect(TestBed.inject(Router).url).toBe('/shipments?status=CREATED&isRoot=true');
    const request = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/shipments`);
    expect(request.request.params.toString()).toBe('limit=20&status=CREATED&isRoot=true');
    request.flush({ items: [], page: 1, limit: 20, total: 0 });
    http.verify();
  });
});
