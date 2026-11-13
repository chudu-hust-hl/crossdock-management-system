import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService, errorMessage } from '../api/api.service';
import { Session } from './session';

const HOME_URL = '/shipments';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
})
export class Login {
  private readonly api = inject(ApiService);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Set when the API refused the previous token. */
  protected readonly expired = this.route.snapshot.queryParamMap.has('expired');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.session.isLoggedIn()) {
      void this.router.navigateByUrl(this.returnUrl());
    }
  }

  protected submit(event: SubmitEvent): void {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    this.submitting.set(true);
    this.error.set(null);
    this.api
      .login(String(data.get('email') ?? '').trim(), String(data.get('password') ?? ''))
      .pipe(
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.session.start(response);
          void this.router.navigateByUrl(this.returnUrl());
        },
        error: (error: unknown) => this.error.set(errorMessage(error)),
      });
  }

  /** Only a path inside this app is followed, never another site. */
  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login')
      ? url
      : HOME_URL;
  }
}
