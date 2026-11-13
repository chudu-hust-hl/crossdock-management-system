import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { Address } from '../api/api.models';
import { ApiService } from '../api/api.service';
import { load, LOADING } from '../api/load-state';

@Component({
  selector: 'app-location-detail',
  imports: [RouterLink, DatePipe],
  templateUrl: './location-detail.html',
})
export class LocationDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  /** `GET /locations/:id` with the ULID from the URL. */
  protected readonly state = toSignal(
    this.route.paramMap.pipe(
      switchMap((params) => load(this.api.getLocation(params.get('id') ?? ''))),
    ),
    { initialValue: LOADING },
  );

  /** The address on one line, e.g. "1 Dai Co Viet, Hanoi, 100000". */
  protected addressLine(address: Address): string {
    return [
      address.addressLine1,
      address.addressLine2,
      address.ward,
      address.district,
      address.city,
      address.province,
      address.postalCode,
      address.country,
    ]
      .filter((part) => !!part)
      .join(', ');
  }
}
