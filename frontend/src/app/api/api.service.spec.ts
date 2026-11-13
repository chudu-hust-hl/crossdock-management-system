import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, toArray } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService, errorMessage } from './api.service';
import { load } from './load-state';

const ULID = '01M5HJ2FXJ9RYWMT6YT7YX9KH7';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists with the given query and leaves out empty filters', () => {
    api.getShipments({ page: 2, limit: 20, status: 'CREATED', code: '' }).subscribe();

    const request = http.expectOne((req) => req.url === `${environment.apiBaseUrl}/shipments`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.toString()).toBe('page=2&limit=20&status=CREATED');
    request.flush({ items: [], page: 2, limit: 20, total: 0 });
  });

  it('reads one record by its ULID', () => {
    api.getLocation(ULID).subscribe();

    http.expectOne(`${environment.apiBaseUrl}/locations/${ULID}`).flush({ id: ULID });
  });

  it('reads the booking view', () => {
    api.getShipmentView(ULID).subscribe();

    const request = http.expectOne(`${environment.apiBaseUrl}/shipments/${ULID}/view`);
    expect(request.request.method).toBe('GET');
    request.flush({});
  });

  it('sends the three booking corrections with PUT', () => {
    const itemId = '01M5HM0P9Q8R7S6T5V4W3X2Y1Z';
    const windows = {
      pickup: { from: '2026-11-10T01:00:00.000Z', to: '2026-11-10T03:00:00.000Z' },
      dropoff: { from: '2026-11-12T06:00:00.000Z', to: '2026-11-12T10:00:00.000Z' },
    };
    const item = {
      description: null,
      itemUnit: 'BOX' as const,
      weight: 3,
      weightUnit: 'KG' as const,
    };

    api.updateCustomer(ULID, 'Cong ty XYZ').subscribe();
    api.updateAppointments(ULID, windows).subscribe();
    api.updateItem(ULID, itemId, item).subscribe();

    const base = `${environment.apiBaseUrl}/shipments/${ULID}`;
    const sent = [
      http.expectOne(base),
      http.expectOne(`${base}/appointments`),
      http.expectOne(`${base}/items/${itemId}`),
    ].map((request) => {
      request.flush({});
      return [request.request.method, request.request.body];
    });
    expect(sent).toEqual([
      ['PUT', { customerName: 'Cong ty XYZ' }],
      ['PUT', windows],
      ['PUT', item],
    ]);
  });

  it('reports loading, then the data', async () => {
    const states = firstValueFrom(load(api.getShipment(ULID)).pipe(toArray()));
    http.expectOne(`${environment.apiBaseUrl}/shipments/${ULID}`).flush({ id: ULID });

    expect(await states).toEqual([{ status: 'loading' }, { status: 'loaded', data: { id: ULID } }]);
  });

  it('reports the message of an error body', async () => {
    const states = firstValueFrom(load(api.getShipment(ULID)).pipe(toArray()));
    http.expectOne(`${environment.apiBaseUrl}/shipments/${ULID}`).flush(
      {
        statusCode: 404,
        message: `Shipment ${ULID} not found`,
        error: 'Not Found',
      },
      { status: 404, statusText: 'Not Found' },
    );

    expect((await states)[1]).toEqual({
      status: 'error',
      message: `404: Shipment ${ULID} not found`,
    });
  });
});

describe('errorMessage', () => {
  it('joins the validation messages of a 400', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        statusCode: 400,
        message: ['page must not be less than 1', 'limit must be an integer'],
        error: 'Bad Request',
      },
    });

    expect(errorMessage(error)).toBe('400: page must not be less than 1; limit must be an integer');
  });

  it('explains when the API cannot be reached', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toBe(
      `Cannot reach the API at ${environment.apiBaseUrl}.`,
    );
  });

  it('falls back to the status text when the body has no message', () => {
    const error = new HttpErrorResponse({
      status: 502,
      statusText: 'Bad Gateway',
    });

    expect(errorMessage(error)).toBe('502: Bad Gateway');
  });
});
