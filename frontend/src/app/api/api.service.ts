import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AppointmentsUpdate,
  ItemUpdate,
  Location,
  LoginResponse,
  Page,
  Shipment,
  ShipmentSummary,
  ShipmentView,
} from './api.models';

/** Query parameters of a list endpoint; empty values are not sent. */
export type ListQuery = Record<string, string | number | undefined>;

/** The only class that talks to the backend; it uses the one app-wide `HttpClient`. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/auth/login`, { email, password });
  }

  getLocations(query: ListQuery): Observable<Page<Location>> {
    return this.http.get<Page<Location>>(`${this.baseUrl}/locations`, {
      params: toHttpParams(query),
    });
  }

  getLocation(id: string): Observable<Location> {
    return this.http.get<Location>(`${this.baseUrl}/locations/${encodeURIComponent(id)}`);
  }

  getShipments(query: ListQuery): Observable<Page<ShipmentSummary>> {
    return this.http.get<Page<ShipmentSummary>>(`${this.baseUrl}/shipments`, {
      params: toHttpParams(query),
    });
  }

  getShipment(id: string): Observable<Shipment> {
    return this.http.get<Shipment>(this.shipmentUrl(id));
  }

  getShipmentView(id: string): Observable<ShipmentView> {
    return this.http.get<ShipmentView>(`${this.shipmentUrl(id)}/view`);
  }

  updateCustomer(id: string, customerName: string): Observable<Shipment> {
    return this.http.put<Shipment>(this.shipmentUrl(id), { customerName });
  }

  updateAppointments(id: string, body: AppointmentsUpdate): Observable<ShipmentView> {
    return this.http.put<ShipmentView>(`${this.shipmentUrl(id)}/appointments`, body);
  }

  updateItem(id: string, itemId: string, body: ItemUpdate): Observable<ShipmentView> {
    return this.http.put<ShipmentView>(
      `${this.shipmentUrl(id)}/items/${encodeURIComponent(itemId)}`,
      body,
    );
  }

  private shipmentUrl(id: string): string {
    return `${this.baseUrl}/shipments/${encodeURIComponent(id)}`;
  }
}

function toHttpParams(query: ListQuery): HttpParams {
  let params = new HttpParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params = params.set(name, value);
    }
  }
  return params;
}

/**
 * The text to show for a failed request. Nest's error body is
 * `{ statusCode, message, error }`, where `message` is a string or, for
 * validation errors, a list of strings.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Unexpected error.';
  }
  if (error.status === 0) {
    return `Cannot reach the API at ${environment.apiBaseUrl}.`;
  }
  const body = error.error as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
  return `${error.status}: ${message ?? error.statusText}`;
}
