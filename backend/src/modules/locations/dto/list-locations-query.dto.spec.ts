import { validateBody } from '../../../../test/utils/validate-body';
import { ListLocationsQueryDto } from './list-locations-query.dto';

describe('ListLocationsQueryDto', () => {
  it('defaults to page 1 of 20, sorted by name ascending', async () => {
    const { value, errors } = await validateBody(ListLocationsQueryDto, {});

    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });

  it('converts query strings and trims text filters', async () => {
    const { value, errors } = await validateBody(ListLocationsQueryDto, {
      page: '3',
      limit: '5',
      type: 'STORE',
      status: 'INACTIVE',
      name: '  hanoi ',
      contactName: 'Nguyen',
      postalCode: ' 100000 ',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      page: 3,
      limit: 5,
      name: 'hanoi',
      postalCode: '100000',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it.each([
    [{ page: '0' }, 'page must not be less than 1'],
    [{ page: 'abc' }, 'page must be an integer number'],
    [{ page: '1.5' }, 'page must be an integer number'],
    [{ limit: '101' }, 'limit must not be greater than 100'],
    [{ limit: '0' }, 'limit must not be less than 1'],
    [
      { type: 'DOCK' },
      'type must be one of the following values: WAREHOUSE, CROSS_DOCK, STORE, CUSTOMER',
    ],
    [
      { status: 'DELETED' },
      'status must be one of the following values: ACTIVE, INACTIVE',
    ],
    [{ name: '   ' }, 'name should not be empty'],
    [{ name: ['a', 'b'] }, 'name must be a string'],
    [
      { sortBy: 'deletedAt' },
      'sortBy must be one of the following values: name, createdAt, updatedAt',
    ],
    [
      { sortOrder: 'up' },
      'sortOrder must be one of the following values: asc, desc',
    ],
    [{ _id: '507f1f77bcf86cd799439011' }, 'property _id should not exist'],
  ])('rejects %j', async (query, message) => {
    const { errors } = await validateBody(ListLocationsQueryDto, query);

    expect(errors).toContain(message);
  });
});
