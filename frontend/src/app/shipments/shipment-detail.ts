import { DatePipe, DecimalPipe, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EditOutline } from '@ant-design/icons-angular/icons';
import { NzIconDirective, provideNzIconsPatch } from 'ng-zorro-antd/icon';
import { BehaviorSubject, combineLatest, finalize, Observable, switchMap } from 'rxjs';
import {
  DeliveryInfo,
  DIMENSION_UNITS,
  ITEM_UNITS,
  ItemUnit,
  ItemUpdate,
  Route,
  Shipment,
  ShipmentView,
  TimeWindow,
  WEIGHT_UNITS,
  WeightUnit,
} from '../api/api.models';
import { ApiService, errorMessage } from '../api/api.service';
import { load, LOADING } from '../api/load-state';

type StoreEnd = 'pickup' | 'dropoff';

/** The one editor that may be open: the customer, one store window, or one item. */
type Editor =
  { kind: 'customer' } | { kind: 'appointment'; end: StoreEnd } | { kind: 'item'; itemId: string };

/** The value of an `<input type="datetime-local">`, in the browser's time zone. */
const LOCAL_INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";

@Component({
  selector: 'app-shipment-detail',
  imports: [RouterLink, DatePipe, DecimalPipe, NzIconDirective],
  providers: [provideNzIconsPatch([EditOutline])],
  templateUrl: './shipment-detail.html',
})
export class ShipmentDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new BehaviorSubject<void>(undefined);

  protected readonly itemUnits = ITEM_UNITS;
  protected readonly weightUnits = WEIGHT_UNITS;
  protected readonly dimensionUnits = DIMENSION_UNITS;
  protected readonly toLocalInput = toLocalInput;
  protected readonly lockedTitle = 'This booking can no longer be edited';

  /** `GET /shipments/:id/view` for the ULID in the URL; again after each saved edit. */
  protected readonly state = toSignal(
    combineLatest([this.route.paramMap, this.reloads]).pipe(
      switchMap(([params]) => load(this.api.getShipmentView(params.get('id') ?? ''))),
    ),
    { initialValue: LOADING },
  );

  protected readonly editor = signal<Editor | null>(null);
  protected readonly saving = signal(false);
  /** The failure of the last save, shown above the open editor. */
  protected readonly editError = signal<string | null>(null);

  private readonly locations = computed(() => {
    const current = this.state();
    return new Map(current.status === 'loaded' ? current.data.locations.map((l) => [l.id, l]) : []);
  });

  protected location(id: string | undefined) {
    return id ? this.locations().get(id) : undefined;
  }

  protected locationName(id: string | undefined): string {
    return this.location(id)?.name ?? 'Unknown location';
  }

  /** Opening an editor closes the one that was open, without saving it. */
  protected open(editor: Editor): void {
    this.editor.set(editor);
    this.editError.set(null);
  }

  protected cancel(): void {
    this.editor.set(null);
    this.editError.set(null);
  }

  protected isEditingCustomer(): boolean {
    return this.editor()?.kind === 'customer';
  }

  protected isEditingAppointment(end: StoreEnd | null): boolean {
    const editor = this.editor();
    return editor?.kind === 'appointment' && editor.end === end;
  }

  protected isEditingItem(itemId: string): boolean {
    const editor = this.editor();
    return editor?.kind === 'item' && editor.itemId === itemId;
  }

  protected points(shipment: Shipment): DeliveryInfo[] {
    return [...shipment.deliveryInfos].sort((a, b) => a.sequence - b.sequence);
  }

  /** `pickup` or `dropoff` for the two store points; `null` for a hub (TRANSIT). */
  protected storeEnd(point: DeliveryInfo): StoreEnd | null {
    return point.type === 'PICKUP' ? 'pickup' : point.type === 'DROPOFF' ? 'dropoff' : null;
  }

  protected isRouted(shipment: Shipment): boolean {
    return shipment.deliveryInfos.some((point) => point.type === 'TRANSIT');
  }

  /** A leg's appointment is the one of its store end, if it has a store. */
  protected legAppointment(leg: Shipment): TimeWindow | undefined {
    return this.points(leg).find((point) => point.appointment.from || point.appointment.to)
      ?.appointment;
  }

  protected routesOf(view: ShipmentView, legId: string): Route[] {
    return view.routes.filter((route) => route.shipmentIds.includes(legId));
  }

  protected snapshotOf(route: Route, legId: string): Route['items'] {
    return route.items.filter((row) => row.shipmentId === legId);
  }

  protected saveCustomer(event: SubmitEvent, shipmentId: string): void {
    const data = submittedForm(event);
    this.save(this.api.updateCustomer(shipmentId, String(data.get('customerName') ?? '').trim()));
  }

  /** Only one window was edited, but the API always receives both. */
  protected saveAppointment(event: SubmitEvent, shipment: Shipment, end: StoreEnd): void {
    const data = submittedForm(event);
    const current = (type: DeliveryInfo['type']) => {
      const appointment = shipment.deliveryInfos.find((point) => point.type === type)?.appointment;
      return { from: appointment?.from ?? '', to: appointment?.to ?? '' };
    };
    const windows = { pickup: current('PICKUP'), dropoff: current('DROPOFF') };
    windows[end] = {
      from: fromLocalInput(String(data.get('from') ?? '')),
      to: fromLocalInput(String(data.get('to') ?? '')),
    };
    this.save(this.api.updateAppointments(shipment.id, windows));
  }

  protected saveItem(event: SubmitEvent, shipmentId: string, itemId: string): void {
    this.save(this.api.updateItem(shipmentId, itemId, itemUpdateFromForm(submittedForm(event))));
  }

  private save(request: Observable<unknown>): void {
    this.saving.set(true);
    this.editError.set(null);
    request
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.editor.set(null);
          this.reloads.next();
        },
        error: (error: unknown) => this.editError.set(errorMessage(error)),
      });
  }
}

function submittedForm(event: SubmitEvent): FormData {
  event.preventDefault();
  return new FormData(event.target as HTMLFormElement);
}

/** An ISO date-time as the value of a `datetime-local` input; `''` when unknown. */
export function toLocalInput(iso: string | null): string {
  return iso ? formatDate(iso, LOCAL_INPUT_FORMAT, 'en-US') : '';
}

/** A `datetime-local` value as an ISO date-time; an invalid value is sent as typed. */
export function fromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * The body of `PUT /shipments/:id/items/:itemId` from the item row's inputs.
 * An empty description removes it. Dimensions are sent only when one of them is filled.
 */
export function itemUpdateFromForm(data: FormData): ItemUpdate {
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const update: ItemUpdate = {
    description: text('description') || null,
    itemUnit: text('itemUnit') as ItemUnit,
    weight: Number(text('weight')),
    weightUnit: text('weightUnit') as WeightUnit,
  };
  if (['length', 'width', 'height'].some((name) => text(name) !== '')) {
    update.dimensions = {
      length: Number(text('length')),
      width: Number(text('width')),
      height: Number(text('height')),
      unit: text('dimensionUnit') as NonNullable<ItemUpdate['dimensions']>['unit'],
    };
  }
  return update;
}
