import { Model } from 'mongoose';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { LocationSortField } from './enums/location-sort-field.enum';
import { LocationStatus } from './enums/location-status.enum';
import { LocationType } from './enums/location-type.enum';
import { LocationsService } from './locations.service';
import { Location } from './schemas/location.schema';

function query(fields: Partial<ListLocationsQueryDto> = {}) {
  return Object.assign(new ListLocationsQueryDto(), fields);
}

describe('LocationsService list query', () => {
  // The filter and sort builders do not use the model.
  const service = new LocationsService({} as Model<Location>);

  it('excludes soft-deleted Locations when no filter is given', () => {
    expect(service.buildListFilter(query())).toEqual({ deletedAt: null });
  });

  it('combines every given filter', () => {
    expect(
      service.buildListFilter(
        query({
          type: LocationType.STORE,
          status: LocationStatus.ACTIVE,
          name: 'store a',
          contactName: 'nguyen',
          postalCode: '100  000',
        }),
      ),
    ).toEqual({
      deletedAt: null,
      type: 'STORE',
      status: 'ACTIVE',
      name: /store a/i,
      contactName: /nguyen/i,
      'address.postalCode': '100 000',
    });
  });

  it('sorts by name ascending by default, with the id as tie-breaker', () => {
    expect(service.buildListSort(query())).toEqual({ name: 'asc', id: 'asc' });
    expect(
      service.buildListSort(
        query({
          sortBy: LocationSortField.CREATED_AT,
          sortOrder: SortOrder.DESC,
        }),
      ),
    ).toEqual({ createdAt: 'desc', id: 'desc' });
  });
});
