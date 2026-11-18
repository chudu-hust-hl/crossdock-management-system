import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { RouteView } from '../api/api.models';
import { SESSION_STORAGE_KEY } from '../auth/session';
import { RouteDetail } from './route-detail';

const ROUTE_ID = '01ROUTE00000000000000000000';
const FROM = '01FROM0000000000000000000000';
const TO = '01TO000000000000000000000000';
const CHILD = '01CHILD000000000000000000000';
const CANDIDATE = '01CANDIDATE00000000000000000';

function view(status: RouteView['route']['status'] = 'PLANNED'): RouteView {
  return {
    route: {
      id: ROUTE_ID,
      routeNumber: 'R-0001-1126',
      status,
      driverName: 'Nguyen Van Tai',
      vehiclePlate: '29A-000.01',
      serviceDate: '2026-11-18',
      slot: 'MORNING',
      appointment: { from: '2026-11-18T01:00:00.000Z', to: '2026-11-18T05:00:00.000Z' },
      fromLocationId: FROM,
      toLocationId: TO,
      shipmentIds: [CHILD],
      stops: [
        stop(2, TO),
        stop(1, FROM),
      ],
      items: [{ itemId: 'ITEM', shipmentId: CHILD, itemCode: 'T-0001-1126', barcode: 'BC-1' }],
    },
    locations: [
      {
        id: FROM,
        name: 'Hanoi Dock',
        type: 'CROSS_DOCK',
        address: { addressLine1: '1 Dai Co Viet', postalCode: '10000', province: 'Hanoi' },
      },
      {
        id: TO,
        name: 'Da Nang Dock',
        type: 'CROSS_DOCK',
        address: { addressLine1: '2 Bach Dang', postalCode: '50000', province: 'Da Nang' },
      },
    ],
    shipments: [
      {
        id: CHILD,
        code: 'S-0002-1126',
        status: 'CREATED',
        parentId: 'ROOT',
        customerName: 'Cong ty ABC',
        itemCount: 1,
      },
    ],
  };
}

function stop(sequence: number, locationId: string): RouteView['route']['stops'][number] {
  return {
    sequence,
    locationId,
    type: 'TRANSIT',
    shipmentIds: [CHILD],
    appointment: { from: null, to: null },
    actualWindow: { from: null, to: null },
    status: 'PENDING',
  };
}

function root(harness: RouterTestingHarness): HTMLElement {
  const element = harness.routeNativeElement;
  if (!element) {
    throw new Error('The route has no element');
  }
  return element;
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

describe('RouteDetail', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'routes/:id', component: RouteDetail }]),
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

  async function open(status: RouteView['route']['status'] = 'PLANNED'): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/routes/${ROUTE_ID}`);
    http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}`).flush(view(status));
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  it('shows both stops in sequence order, with the shipment and the snapshot', async () => {
    signIn('DOCK_MANAGER');
    const harness = await open();
    const text = root(harness).textContent ?? '';

    expect(text).toContain('R-0001-1126');
    expect(text).toContain('MORNING 2026-11-18');
    expect(text).toContain('Nguyen Van Tai');
    const cards = [...root(harness).querySelectorAll('section.card h2')].map(
      (heading) => heading.textContent?.trim(),
    );
    expect(cards.slice(0, 2)).toEqual(['Stop 1', 'Stop 2']);
    const shipmentLinks = [...root(harness).querySelectorAll('a[href^="/shipments/"]')].map(
      (link) => [link.textContent?.trim(), link.getAttribute('href')],
    );
    expect(shipmentLinks).toEqual([
      ['S-0002-1126', '/shipments/ROOT'],
      ['S-0002-1126', '/shipments/ROOT'],
    ]);
    expect(text).toContain('T-0001-1126');
    expect(text).toContain('BC-1');
    expect(root(harness).querySelector('button.primary')?.textContent?.trim()).toBe(
      'Add',
    );
  });

  it('does not offer Add when the route is not PLANNED', async () => {
    signIn('DOCK_MANAGER');
    const harness = await open('IN_PROGRESS');
    expect(root(harness).textContent).not.toContain('Add');
  });

  it('does not offer Add to an ADMIN', async () => {
    signIn('ADMIN');
    const harness = await open();
    expect(root(harness).textContent).not.toContain('Add');
  });

  it('moves the selected candidates and reloads the detail', async () => {
    signIn('SYS_ADMIN');
    const harness = await open();
    (root(harness).querySelector('button.primary') as HTMLButtonElement).click();
    harness.detectChanges();

    const candidates = http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/candidates`);
    candidates.flush([
      {
        id: CANDIDATE,
        code: 'S-0004-1126',
        parentCode: 'S-0003-1126',
        customerName: 'Cong ty XYZ',
        itemCount: 2,
      },
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const save = [...root(harness).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Save',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const box = root(harness).querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(save.disabled).toBe(false);

    save.click();
    const posted = http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/shipments`);
    expect(posted.request.body).toEqual({ shipmentIds: [CANDIDATE] });
    posted.flush(view());
    http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}`).flush(view());
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(root(harness).textContent).not.toContain('Add shipments');
  });

  it('leaves the selection in place when the move fails, and Cancel sends nothing', async () => {
    signIn('SYS_ADMIN');
    const harness = await open();
    (root(harness).querySelector('button.primary') as HTMLButtonElement).click();
    harness.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/candidates`).flush([
      {
        id: CANDIDATE,
        code: 'S-0004-1126',
        parentCode: 'S-0003-1126',
        customerName: 'Cong ty XYZ',
        itemCount: 2,
      },
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const box = root(harness).querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    harness.detectChanges();
    const save = [...root(harness).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Save',
    ) as HTMLButtonElement;
    save.click();
    http
      .expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/shipments`)
      .flush({ message: 'Route R-0001-1126 is IN_PROGRESS, not PLANNED' }, { status: 409, statusText: 'Conflict' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root(harness).textContent).toContain('409:');
    expect(
      (root(harness).querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
    ).toBe(true);

    const cancel = [...root(harness).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement;
    cancel.click();
    harness.detectChanges();
    expect(root(harness).textContent).not.toContain('Add shipments');
    http.expectNone(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/candidates`);
    http.expectNone(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/shipments`);
  });

  it('says when there is no candidate', async () => {
    signIn('SYS_ADMIN');
    const harness = await open();
    (root(harness).querySelector('button.primary') as HTMLButtonElement).click();
    harness.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/routes/${ROUTE_ID}/candidates`).flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(root(harness).textContent).toContain(
      'There is no CREATED shipment with these two ends.',
    );
  });
});
