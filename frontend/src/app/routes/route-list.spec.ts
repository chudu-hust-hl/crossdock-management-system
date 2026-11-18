import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { RouteEnd } from '../api/api.models';
import { placeLabel, RouteList, scheduleLabel } from './route-list';

const end = (name: string | null, province: string | null): RouteEnd => ({
  id: 'LOC',
  name,
  type: name ? 'CROSS_DOCK' : null,
  province,
});

describe('route list labels', () => {
  it('joins the location name and province', () => {
    expect(placeLabel(end('Hanoi Dock', 'Hanoi'))).toBe('Hanoi Dock, Hanoi');
    expect(placeLabel(end('Hanoi Dock', null))).toBe('Hanoi Dock');
    expect(placeLabel(end(null, null))).toBe('Unknown location');
  });

  it('shows the slot and service date, or Dedicated', () => {
    expect(scheduleLabel({ serviceDate: '2026-11-18', slot: 'MORNING' })).toBe(
      'MORNING 2026-11-18',
    );
    expect(scheduleLabel({})).toBe('Dedicated');
  });
});

describe('RouteList', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'routes', component: RouteList }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('sends the filters from the URL, and Clear drops them', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/routes?status=PLANNED&routeNumber=R-0001&page=2');

    const listed = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/routes`);
    expect(listed.request.params.toString()).toBe(
      'page=2&limit=20&routeNumber=R-0001&status=PLANNED',
    );
    listed.flush({ items: [], page: 2, limit: 20, total: 0 });

    const element = harness.routeNativeElement;
    if (!element) {
      throw new Error('The route has no element');
    }
    (element.querySelector('button[type="button"]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();

    expect(router.url).toBe('/routes');
    const cleared = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/routes`);
    expect(cleared.request.params.toString()).toBe('limit=20');
    cleared.flush({ items: [], page: 1, limit: 20, total: 0 });
    http.verify();
  });
});
