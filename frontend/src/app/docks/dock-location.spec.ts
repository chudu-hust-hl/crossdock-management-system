import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { DockRoute } from '../api/api.models';
import { DockLocation } from './dock-location';

const DOCK = '01DOCK0000000000000000000000';
const INBOUND = '01INBOUND000000000000000000';
const OUTBOUND = '01OUTBOUND00000000000000000';

function row(id: string, routeNumber: string): DockRoute {
  return {
    id,
    routeNumber,
    status: 'PLANNED',
    serviceDate: '2026-11-18',
    slot: 'MORNING',
    appointment: { from: '2026-11-18T01:00:00.000Z', to: '2026-11-18T05:00:00.000Z' },
    shipmentCount: 2,
    otherEnd: { id: '01OTHER00000000000000000000', name: 'Hai Phong Dock', province: 'Hai Phong' },
    stopSequence: 2,
    stopStatus: 'PROCESSING',
    pendingTaskCount: 3,
  };
}

describe('DockLocation', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'docks/:locationId', component: DockLocation }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function requests(harness: RouterTestingHarness) {
    const location = http.expectOne(`${environment.apiBaseUrl}/locations/${DOCK}`);
    const lists = http.match((req) => req.url === `${environment.apiBaseUrl}/docks/${DOCK}/routes`);
    return { harness, location, lists };
  }

  it('loads inbound and outbound with the URL filters, and an inbound route stays out of outbound', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/docks/${DOCK}?status=PLANNED&routeNumber=R-0001&page=2`);
    const { location, lists } = requests(harness);

    expect(lists.map((req) => req.request.params.get('direction')).sort()).toEqual([
      'inbound',
      'outbound',
    ]);
    for (const req of lists) {
      expect(req.request.params.get('status')).toBe('PLANNED');
      expect(req.request.params.get('routeNumber')).toBe('R-0001');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('limit')).toBe('20');
    }

    location.flush({ id: DOCK, name: 'Hanoi Dock' });
    const inbound = lists.find((req) => req.request.params.get('direction') === 'inbound');
    const outbound = lists.find((req) => req.request.params.get('direction') === 'outbound');
    inbound?.flush({ items: [row(INBOUND, 'R-0001-1126')], page: 2, limit: 20, total: 1 });
    outbound?.flush({ items: [row(OUTBOUND, 'R-0009-1126')], page: 2, limit: 20, total: 1 });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain('Hanoi Dock');
    const links = [...(harness.routeNativeElement?.querySelectorAll('a.key') ?? [])].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['R-0001-1126', `/docks/${DOCK}/routes/${INBOUND}?direction=inbound`],
      ['R-0009-1126', `/docks/${DOCK}/routes/${OUTBOUND}?direction=outbound`],
    ]);
    expect(text).toContain('Hai Phong Dock, Hai Phong');
    expect(text).toContain('MORNING 2026-11-18');
    expect(text).toContain('PROCESSING');
    expect(text).toContain('3');
  });

  it('shows a 404 from the API on the page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/docks/${DOCK}`);
    const { location, lists } = requests(harness);

    location.flush(
      { statusCode: 404, message: `Location ${DOCK} not found`, error: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );
    for (const req of lists) {
      req.flush(
        { statusCode: 404, message: `Location ${DOCK} is not a cross-dock`, error: 'Not Found' },
        { status: 404, statusText: 'Not Found' },
      );
    }
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent).toContain(`404: Location ${DOCK} not found`);
  });

  it('drops the filters when Clear is clicked', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl(`/docks/${DOCK}?status=PLANNED`);
    const first = requests(harness);
    first.location.flush({ id: DOCK, name: 'Hanoi Dock' });
    for (const req of first.lists) {
      req.flush({ items: [], page: 1, limit: 20, total: 0 });
    }
    await harness.fixture.whenStable();

    (harness.routeNativeElement?.querySelector('button[type="button"]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();

    expect(router.url).toBe(`/docks/${DOCK}`);
    const again = http.match(
      (req) => req.url === `${environment.apiBaseUrl}/docks/${DOCK}/routes`,
    );
    expect(again).toHaveLength(2);
    for (const req of again) {
      expect(req.request.params.get('direction')).toMatch(/^(inbound|outbound)$/);
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('status')).toBeNull();
      req.flush({ items: [], page: 1, limit: 20, total: 0 });
    }
  });
});
