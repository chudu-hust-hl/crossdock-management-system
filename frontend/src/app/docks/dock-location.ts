import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, switchMap } from 'rxjs';
import { DockDirection, ROUTE_SLOTS, ROUTE_STATUSES } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { filtersFromForm, queryFromUrl } from '../shared/list-query';
import { Pager } from '../shared/pager';
import { placeLabel, scheduleLabel } from '../routes/route-list';

/** Query parameters shared by the inbound and outbound lists. */
const FILTERS = ['routeNumber', 'status', 'serviceDate', 'slot'] as const;

@Component({
  selector: 'app-dock-location',
  imports: [RouterLink, Pager],
  templateUrl: './dock-location.html',
})
export class DockLocation {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly statuses = ROUTE_STATUSES;
  protected readonly slots = ROUTE_SLOTS;
  protected readonly placeLabel = placeLabel;
  protected readonly scheduleLabel = scheduleLabel;
  protected readonly params = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  /** The dock named in the heading. A 404 is shown on this page. */
  protected readonly location = toSignal(
    this.route.paramMap.pipe(
      switchMap((params) => load(this.api.getLocation(params.get('locationId') ?? ''))),
    ),
    { initialValue: LOADING },
  );

  /**
   * Both lists use the same URL filters and the same `page`.
   * Each list still has its own pager, because each has its own total.
   */
  protected readonly inbound = toSignal(this.routes('inbound'), { initialValue: LOADING });
  protected readonly outbound = toSignal(this.routes('outbound'), { initialValue: LOADING });

  protected search(event: SubmitEvent): void {
    event.preventDefault();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersFromForm(event.target as HTMLFormElement, FILTERS),
      queryParamsHandling: 'merge',
    });
  }

  /** Drops every filter and the page. Nothing else stays in the URL. */
  protected clear(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  private routes(direction: DockDirection) {
    return combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      switchMap(([params, query]) =>
        load(
          this.api.getDockRoutes(params.get('locationId') ?? '', {
            ...queryFromUrl(query, FILTERS),
            direction,
          }),
        ),
      ),
    );
  }
}
