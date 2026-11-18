import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { DockList } from './dock-list';

const DOCK = '01DOCK0000000000000000000000';

describe('DockList', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'docks', component: DockList }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('lists cross-docks and links each one to its desk', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);

    await harness.navigateByUrl('/docks?page=1');

    const listed = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/locations`);
    expect(listed.request.params.toString()).toBe('type=CROSS_DOCK&page=1&limit=20');
    listed.flush({
      items: [
        {
          id: DOCK,
          name: 'Hanoi Dock',
          address: { province: 'Hanoi' },
          status: 'ACTIVE',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const link = harness.routeNativeElement?.querySelector('a.key');
    expect(link?.textContent?.trim()).toBe('Hanoi Dock');
    expect(link?.getAttribute('href')).toBe(`/docks/${DOCK}`);
    expect(harness.routeNativeElement?.textContent).toContain('Hanoi');
    expect(harness.routeNativeElement?.textContent).toContain('ACTIVE');
    http.verify();
  });
});
