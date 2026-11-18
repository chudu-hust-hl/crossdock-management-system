import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, forkJoin, map, of, switchMap } from 'rxjs';
import { DockDirection, DockRoute, UserRole } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { Session } from '../auth/session';
import { placeLabel } from '../routes/route-list';

/** Who may see the task list. Anyone else is not offered the request. */
const CAN_WORK: readonly UserRole[] = ['SYS_ADMIN', 'DOCK_MANAGER', 'DOCK_OPERATOR'];

/** The route, plus the dock row for this direction when the list includes it. */
interface DockWorkView {
  routeNumber: string;
  row: DockRoute | null;
}

@Component({
  selector: 'app-dock-work',
  imports: [RouterLink],
  templateUrl: './dock-work.html',
})
export class DockWork {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(Session);

  protected readonly placeLabel = placeLabel;

  protected readonly direction = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('direction') as DockDirection),
    ),
    { requireSync: true },
  );

  /**
   * The route number comes from `GET /routes/:id`. The other end, stop status,
   * and pending count come from the dock list for this direction.
   */
  protected readonly state = toSignal(
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      switchMap(([params, query]) => {
        const locationId = params.get('locationId') ?? '';
        const routeId = params.get('routeId') ?? '';
        const direction = query.get('direction') ?? '';
        return load(
          forkJoin({
            view: this.api.getRoute(routeId),
            page: this.api.getDockRoutes(locationId, { direction, page: 1, limit: 100 }),
          }).pipe(
            map(
              ({ view, page }): DockWorkView => ({
                routeNumber: view.route.routeNumber,
                row: page.items.find((item) => item.id === routeId) ?? null,
              }),
            ),
          ),
        );
      }),
    ),
    { initialValue: LOADING },
  );

  /**
   * Pending tasks at this dock. Not requested unless the logged-in user
   * may work a dock.
   */
  protected readonly tasks = toSignal(
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      switchMap(([params, query]) => {
        if (!this.canWork() || !query.get('direction')) {
          return of(null);
        }
        return load(
          this.api.getDockTasks({
            locationId: params.get('locationId') ?? '',
            routeId: params.get('routeId') ?? '',
          }),
        );
      }),
    ),
    { initialValue: null },
  );

  protected canWork(): boolean {
    const roles = this.session.user()?.roles ?? [];
    return roles.some((role) => CAN_WORK.includes(role));
  }

  protected locationId(): string {
    return this.route.snapshot.paramMap.get('locationId') ?? '';
  }

  protected routeId(): string {
    return this.route.snapshot.paramMap.get('routeId') ?? '';
  }
}
