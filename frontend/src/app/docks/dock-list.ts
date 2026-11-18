import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { PAGE_LIMIT } from '../shared/list-query';
import { Pager } from '../shared/pager';

@Component({
  selector: 'app-dock-list',
  imports: [RouterLink, Pager],
  templateUrl: './dock-list.html',
})
export class DockList {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  /** Every cross-dock. The page is the only query this list keeps. */
  protected readonly state = toSignal(
    this.route.queryParamMap.pipe(
      switchMap((params) =>
        load(
          this.api.getLocations({
            type: 'CROSS_DOCK',
            page: params.get('page') ?? undefined,
            limit: PAGE_LIMIT,
          }),
        ),
      ),
    ),
    { initialValue: LOADING },
  );
}
