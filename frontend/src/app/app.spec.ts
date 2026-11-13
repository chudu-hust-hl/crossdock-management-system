import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SESSION_STORAGE_KEY } from './auth/session';

describe('App', () => {
  beforeEach(async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        accessToken: 'token',
        expiresAt: Date.now() + 60_000,
        user: { id: 'U1', fullName: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      }),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => localStorage.removeItem(SESSION_STORAGE_KEY));

  it('shows the navigation to both features', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map(
      (link) => [link.textContent?.trim(), link.getAttribute('href')],
    );

    expect(links).toEqual([
      ['Shipments', '/shipments'],
      ['Locations', '/locations'],
    ]);
  });
});
