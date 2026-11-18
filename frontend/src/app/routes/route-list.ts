import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { ROUTE_SLOTS, ROUTE_STATUSES, RouteEnd, RouteSummary } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { filtersFromForm, queryFromUrl } from '../shared/list-query';
import { Pager } from '../shared/pager';

/** Query parameters of `GET /routes` offered as filters. */
const FILTERS = ['routeNumber', 'status', 'serviceDate', 'slot'] as const;

@Component({
  selector: 'app-route-list',
  imports: [RouterLink, Pager],
  templateUrl: './route-list.html',
})
export class RouteList {
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
  /** Every change of the URL query (filters, page) requests the list again. */
  protected readonly state = toSignal(
    this.route.queryParamMap.pipe(
      switchMap((params) => load(this.api.getRoutes(queryFromUrl(params, FILTERS)))),
    ),
    { initialValue: LOADING },
  );

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
}

/** `Hanoi Dock, Hanoi`, or `Unknown location` when the Location was not found. */
export function placeLabel(end: RouteEnd): string {
  if (!end.name) {
    return 'Unknown location';
  }
  return end.province ? `${end.name}, ${end.province}` : end.name;
}

/** `MORNING 2026-11-18` for a dock–dock route; a route without a slot is dedicated. */
export function scheduleLabel(route: Pick<RouteSummary, 'serviceDate' | 'slot'>): string {
  return route.serviceDate && route.slot ? `${route.slot} ${route.serviceDate}` : 'Dedicated';
}
