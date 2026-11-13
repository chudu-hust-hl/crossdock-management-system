import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { SHIPMENT_STATUSES, ShipmentEnd, ShipmentSummary } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { filtersFromForm, queryFromUrl } from '../shared/list-query';
import { Pager } from '../shared/pager';

/** Query parameters of `GET /shipments` offered as filters. */
const FILTERS = ['code', 'customerName', 'status'] as const;

/** The list shows bookings (root shipments) only; this is always in the URL. */
const ROOTS_ONLY = { isRoot: 'true' };

/** Items shown by name in a row; the rest are counted as "+N". */
const ITEMS_SHOWN = 3;

@Component({
  selector: 'app-shipment-list',
  imports: [RouterLink, DatePipe, DecimalPipe, Pager],
  templateUrl: './shipment-list.html',
})
export class ShipmentList {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly statuses = SHIPMENT_STATUSES;
  protected readonly itemsLine = itemsLine;
  protected readonly params = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });
  /**
   * Every change of the URL query (filters, page) requests the list again. A URL
   * without `isRoot=true` is first replaced by one with it, which then loads.
   */
  protected readonly state = toSignal(
    this.route.queryParamMap.pipe(
      switchMap((params) => {
        if (params.get('isRoot') !== 'true') {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: ROOTS_ONLY,
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
          return of(LOADING);
        }
        return load(this.api.getShipments(queryFromUrl(params, [...FILTERS, 'isRoot'])));
      }),
    ),
    { initialValue: LOADING },
  );

  protected search(event: SubmitEvent): void {
    event.preventDefault();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...filtersFromForm(event.target as HTMLFormElement, FILTERS), ...ROOTS_ONLY },
      queryParamsHandling: 'merge',
    });
  }

  protected clear(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: ROOTS_ONLY });
  }

  protected endLabel(end: ShipmentEnd | null): string {
    if (!end?.name) {
      return 'Unknown location';
    }
    return end.province ? `${end.name}, ${end.province}` : end.name;
  }
}

/** `T-0001-1026 · BOX · 2.5 KG, …`, at most three items, then `+N`. */
export function itemsLine(items: ShipmentSummary['items']): string {
  const shown = items.slice(0, ITEMS_SHOWN).map((item) => {
    const parts: string[] = [item.itemCode, item.itemUnit];
    if (item.weight != null) {
      parts.push(`${item.weight} ${item.weightUnit ?? ''}`.trim());
    }
    return parts.join(' · ');
  });
  const hidden = items.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')} +${hidden}` : shown.join(', ');
}
