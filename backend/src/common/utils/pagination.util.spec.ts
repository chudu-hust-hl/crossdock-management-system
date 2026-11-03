import { SortOrder } from '../enums/sort-order.enum';
import { buildSort } from './pagination.util';

describe('buildSort', () => {
  it('sorts by the field, then by id in the same direction', () => {
    expect(buildSort('name', SortOrder.ASC)).toEqual({
      name: 'asc',
      id: 'asc',
    });
    expect(Object.keys(buildSort('createdAt', SortOrder.DESC))).toEqual([
      'createdAt',
      'id',
    ]);
  });
});
