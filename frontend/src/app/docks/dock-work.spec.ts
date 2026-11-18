import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { DockRoute, RouteView } from '../api/api.models';
import { SESSION_STORAGE_KEY } from '../auth/session';
import { DOCK_ROUTES } from './docks.routes';

const DOCK = '01DOCK0000000000000000000000';
const ROUTE = '01ROUTE00000000000000000000';

function view(): RouteView {
  return {
    route: {
      id: ROUTE,
      routeNumber: 'R-0001-1126',
      status: 'IN_PROGRESS',
      driverName: 'Nguyen Van Tai',
      vehiclePlate: '29A-000.01',
      appointment: { from: '2026-11-18T01:00:00.000Z', to: '2026-11-18T05:00:00.000Z' },
      fromLocationId: '01FROM0000000000000000000000',
      toLocationId: DOCK,
      shipmentIds: [],
      stops: [],
      items: [],
    },
    locations: [],
    shipments: [],
  };
}

function dockRow(): DockRoute {
  return {
    id: ROUTE,
    routeNumber: 'R-0001-1126',
    status: 'IN_PROGRESS',
    appointment: { from: '2026-11-18T01:00:00.000Z', to: '2026-11-18T05:00:00.000Z' },
    shipmentCount: 1,
    otherEnd: { id: '01FROM0000000000000000000000', name: 'Bac Bo Store', province: 'Hanoi' },
    stopSequence: 2,
    stopStatus: 'ARRIVED',
    pendingTaskCount: 1,
  };
}

function signIn(...roles: string[]): void {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      accessToken: 'token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'U1', fullName: 'Ada', email: 'ada@example.com', roles, status: 'ACTIVE' },
    }),
  );
}

function root(harness: RouterTestingHarness): HTMLElement {
  const element = harness.routeNativeElement;
  if (!element) {
    throw new Error('The route has no element');
  }
  return element;
}

describe('DockWork', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'docks', children: DOCK_ROUTES }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    http.verify();
  });

  function flushWork(): void {
    http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE}`).flush(view());
    const list = http.expectOne(
      (req) => req.url === `${environment.apiBaseUrl}/docks/${DOCK}/routes`,
    );
    expect(list.request.params.get('direction')).toBe('inbound');
    expect(list.request.params.has('routeNumber')).toBe(false);
    list.flush({ items: [dockRow()], page: 1, limit: 100, total: 1 });
  }

  it('returns to the dock when direction is missing', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/docks/${DOCK}/routes/${ROUTE}`);

    expect(TestBed.inject(Router).url).toBe(`/docks/${DOCK}`);
    http.expectOne(`${environment.apiBaseUrl}/locations/${DOCK}`).flush({
      id: DOCK,
      name: 'Hanoi Dock',
    });
    const lists = http.match(
      (req) => req.url === `${environment.apiBaseUrl}/docks/${DOCK}/routes`,
    );
    expect(lists).toHaveLength(2);
    for (const req of lists) {
      req.flush({ items: [], page: 1, limit: 20, total: 0 });
    }
    http.expectNone(`${environment.apiBaseUrl}/routes/${ROUTE}`);
    http.expectNone((req) => req.url === `${environment.apiBaseUrl}/dock-tasks`);
  });

  it('shows the pending tasks and a disabled scan button for a dock operator', async () => {
    signIn('DOCK_OPERATOR');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/docks/${DOCK}/routes/${ROUTE}?direction=inbound`);
    flushWork();
    const tasks = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/dock-tasks`);
    expect(tasks.request.params.toString()).toBe(`locationId=${DOCK}&routeId=${ROUTE}`);
    tasks.flush([
      { id: '01TASK000000000000000000000', itemCode: 'T-0001-1126', barcode: 'BC-1', type: 'SCAN_INBOUND' },
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const element = root(harness);
    const text = element.textContent ?? '';
    expect(text).toContain('R-0001-1126');
    expect(text).toContain('inbound');
    expect(text).toContain('Bac Bo Store, Hanoi');
    expect(text).toContain('ARRIVED');
    expect(text).toContain('T-0001-1126');
    expect(text).toContain('BC-1');
    expect(text).toContain('SCAN_INBOUND');
    expect(text).not.toContain('Mark missing');
    expect(text).not.toContain('You cannot work this dock.');

    const button = element.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Scanning is not available on this screen yet');
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    http.expectNone((req) => req.method === 'POST');

    const links = [...element.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toContain(`/docks/${DOCK}`);
    expect(links).toContain(`/routes/${ROUTE}`);
  });

  it('does not load tasks for a user who cannot work the dock', async () => {
    signIn('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/docks/${DOCK}/routes/${ROUTE}?direction=inbound`);
    flushWork();
    await harness.fixture.whenStable();
    harness.detectChanges();

    http.expectNone((req) => req.url === `${environment.apiBaseUrl}/dock-tasks`);
    expect(root(harness).textContent).toContain('You cannot work this dock.');
    expect(root(harness).querySelector('button[type="submit"]')).toBeNull();
  });
});
