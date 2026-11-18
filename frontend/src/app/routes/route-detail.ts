import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, combineLatest, finalize, Subject, switchMap } from 'rxjs';
import {
  RouteCandidate,
  RouteLocation,
  RouteShipment,
  RouteStop,
  RouteView,
  UserRole,
} from '../api/api.models';
import { ApiService, errorMessage } from '../api/api.service';
import { load, LOADING } from '../api/load-state';
import { Session } from '../auth/session';
import { scheduleLabel } from './route-list';

/** Who may move shipments onto a route; the same roles the API accepts. */
const CAN_ADD: readonly UserRole[] = ['SYS_ADMIN', 'DOCK_MANAGER'];

@Component({
  selector: 'app-route-detail',
  imports: [RouterLink, DatePipe],
  templateUrl: './route-detail.html',
})
export class RouteDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new BehaviorSubject<void>(undefined);
  private readonly candidateLoads = new Subject<string>();

  protected readonly scheduleLabel = scheduleLabel;

  /** `GET /routes/:id` for the ULID in the URL; again after a saved move. */
  protected readonly state = toSignal(
    combineLatest([this.route.paramMap, this.reloads]).pipe(
      switchMap(([params]) => load(this.api.getRoute(params.get('id') ?? ''))),
    ),
    { initialValue: LOADING },
  );

  /** The add panel is open. It is not a separate route. */
  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The failure of the last save, shown in the panel. The selection stays. */
  protected readonly addError = signal<string | null>(null);
  protected readonly candidates = toSignal(
    this.candidateLoads.pipe(switchMap((id) => load(this.api.getRouteCandidates(id)))),
    { initialValue: LOADING },
  );

  /** Add is shown only on a PLANNED route, and only for a dock manager or a system admin. */
  protected canAdd(view: RouteView): boolean {
    const roles = this.session.user()?.roles ?? [];
    return view.route.status === 'PLANNED' && roles.some((role) => CAN_ADD.includes(role));
  }

  protected stops(view: RouteView): RouteStop[] {
    return [...view.route.stops].sort((left, right) => left.sequence - right.sequence);
  }

  protected locationOf(view: RouteView, locationId: string): RouteLocation | undefined {
    return view.locations.find((location) => location.id === locationId);
  }

  /** A child opens its booking. A root, if one were listed, opens itself. */
  protected bookingId(shipment: RouteShipment): string {
    return shipment.parentId ?? shipment.id;
  }

  /** Shipments listed on this stop, in the stop's `shipmentIds` order. */
  protected shipmentsAt(view: RouteView, stop: RouteStop): RouteShipment[] {
    const byId = new Map(view.shipments.map((shipment) => [shipment.id, shipment]));
    return stop.shipmentIds.flatMap((id) => {
      const shipment = byId.get(id);
      return shipment ? [shipment] : [];
    });
  }

  /** Snapshot rows grouped by the child shipment's code. */
  protected snapshotGroups(view: RouteView): { code: string; rows: RouteView['route']['items'] }[] {
    const codeOf = new Map(view.shipments.map((shipment) => [shipment.id, shipment.code]));
    const groups = new Map<string, RouteView['route']['items']>();
    for (const item of view.route.items) {
      const code = codeOf.get(item.shipmentId) ?? item.shipmentId;
      const rows = groups.get(code);
      if (rows) {
        rows.push(item);
      } else {
        groups.set(code, [item]);
      }
    }
    return [...groups.entries()].map(([code, rows]) => ({ code, rows }));
  }

  protected openAdd(): void {
    this.adding.set(true);
    this.selected.set(new Set());
    this.addError.set(null);
    this.candidateLoads.next(this.route.snapshot.paramMap.get('id') ?? '');
  }

  /** Closes the panel. It does not call the API. */
  protected cancelAdd(): void {
    this.adding.set(false);
    this.addError.set(null);
  }

  protected toggle(id: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.selected.set(next);
  }

  protected checkboxChecked(event: Event): boolean {
    return event.target instanceof HTMLInputElement && event.target.checked;
  }

  protected saveSelected(routeId: string): void {
    const listed = this.candidates();
    this.save(routeId, listed.status === 'loaded' ? listed.data : []);
  }

  protected save(routeId: string, rows: RouteCandidate[]): void {
    const chosen = this.selected();
    const shipmentIds = rows.filter((row) => chosen.has(row.id)).map((row) => row.id);
    if (shipmentIds.length === 0 || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.addError.set(null);
    this.api
      .addRouteShipments(routeId, shipmentIds)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.adding.set(false);
          this.reloads.next();
        },
        error: (error: unknown) => this.addError.set(errorMessage(error)),
      });
  }
}
