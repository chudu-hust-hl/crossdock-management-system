import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { LOCATION_STATUSES, LOCATION_TYPES } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { filtersFromForm, queryFromUrl } from '../shared/list-query';
import { Pager } from '../shared/pager';

/** Query parameters of `GET /locations` offered as filters. */
const FILTERS = ['name', 'type', 'status', 'postalCode'] as const;

@Component({
  selector: 'app-location-list',
  imports: [RouterLink, Pager],
  templateUrl: './location-list.html',
})
export class LocationList {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly types = LOCATION_TYPES;
  protected readonly statuses = LOCATION_STATUSES;
  protected readonly params = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });
  /** Every change of the URL query (filters, page) requests the list again. */
  protected readonly state = toSignal(
    this.route.queryParamMap.pipe(
      switchMap((params) => load(this.api.getLocations(queryFromUrl(params, FILTERS)))),
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

  protected clear(): void {
    void this.router.navigate([], { relativeTo: this.route });
  }
}
