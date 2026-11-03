import { Types } from 'mongoose';
import { validateBody } from '../../../../test/utils/validate-body';
import { generateUlid } from '../../../common/utils/ulid.util';
import { ListShipmentsQueryDto } from './list-shipments-query.dto';

describe('ListShipmentsQueryDto', () => {
  it('defaults to page 1 of 20, newest first', async () => {
    const { value, errors } = await validateBody(ListShipmentsQueryDto, {});

    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(value!.isRoot).toBeUndefined();
  });

  it('accepts every filter with ULID references', async () => {
    const ids = {
      parentId: generateUlid(),
      itemId: generateUlid(),
      locationId: generateUlid(),
    };

    const { value, errors } = await validateBody(ListShipmentsQueryDto, {
      ...ids,
      status: 'CREATED',
      code: ' s-0001 ',
      customerName: 'abc',
      sortBy: 'cost',
      sortOrder: 'asc',
    });

    expect(errors).toEqual([]);
    expect(value).toMatchObject({ ...ids, code: 's-0001', sortBy: 'cost' });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads isRoot=%s as a boolean', async (text, expected) => {
    const { value } = await validateBody(ListShipmentsQueryDto, {
      isRoot: text,
    });

    expect(value!.isRoot).toBe(expected);
  });

  it.each([
    [{ isRoot: 'yes' }, 'isRoot must be a boolean value'],
    [{ isRoot: '1' }, 'isRoot must be a boolean value'],
    [{ parentId: new Types.ObjectId().toString() }, 'parentId must be a ULID'],
    [{ itemId: generateUlid().toLowerCase() }, 'itemId must be a ULID'],
    [{ locationId: 'abc' }, 'locationId must be a ULID'],
    [
      { status: 'LOST' },
      'status must be one of the following values: CREATED, IN_TRANSIT, AT_DOCK, DELIVERED, CANCELLED, EXCEPTION',
    ],
    [{ customerName: '' }, 'customerName should not be empty'],
    [
      { sortBy: 'deliveryInfos' },
      'sortBy must be one of the following values: createdAt, updatedAt, code, customerName, cost',
    ],
    [{ limit: '1000' }, 'limit must not be greater than 100'],
    [{ id: generateUlid() }, 'property id should not exist'],
  ])('rejects %j', async (query, message) => {
    const { errors } = await validateBody(ListShipmentsQueryDto, query);

    expect(errors).toContain(message);
  });
});
