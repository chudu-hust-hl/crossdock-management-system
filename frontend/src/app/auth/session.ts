import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LoginResponse, User } from '../api/api.models';

/** The `localStorage` key of the session, so a reload or a new tab stays logged in. */
export const SESSION_STORAGE_KEY = 'cross-dock.session';

interface StoredSession {
  accessToken: string;
  /** Epoch milliseconds; the backend rejects the token after this moment. */
  expiresAt: number;
  user: User;
}

/** The logged-in user and their access token, from login until logout or expiry. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly router = inject(Router);
  private readonly stored = signal<StoredSession | null>(readStoredSession());

  /** The user shown in the header; `null` when nobody is logged in. */
  readonly user = computed(() => this.stored()?.user ?? null);

  start(response: LoginResponse): void {
    this.save({
      accessToken: response.accessToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      user: response.user,
    });
  }

  /** The token while it is still valid. An expired session is ended here. */
  token(): string | null {
    const session = this.stored();
    if (session && session.expiresAt <= Date.now()) {
      this.save(null);
      return null;
    }
    return session?.accessToken ?? null;
  }

  isLoggedIn(): boolean {
    return this.token() !== null;
  }

  logout(): void {
    this.save(null);
    void this.router.navigate(['/login']);
  }

  /** The API refused the token (expired, user deactivated): log in again, then come back. */
  end(returnUrl: string): void {
    this.save(null);
    void this.router.navigate(['/login'], { queryParams: { returnUrl, expired: 1 } });
  }

  private save(session: StoredSession | null): void {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    this.stored.set(session);
  }
}

function readStoredSession(): StoredSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') as StoredSession | null;
  } catch {
    return null;
  }
}
