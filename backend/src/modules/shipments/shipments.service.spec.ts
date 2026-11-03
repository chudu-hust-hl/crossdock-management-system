import { BadRequestException } from '@nestjs/common';
import { generateUlid } from '../../common/utils/ulid.util';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { ShipmentStatus } from './enums/shipment-status.enum';
import { ShipmentsService } from './shipments.service';

function query(fields: Partial<ListShipmentsQueryDto> = {}) {
  return Object.assign(new ListShipmentsQueryDto(), fields);
}

describe('ShipmentsService list query', () => {
  // The filter and sort builders use none of the injected dependencies.
  const unused = {} as never;
  const service = new ShipmentsService(unused, unused, unused, unused, unused);

  it('excludes soft-deleted Shipments when no filter is given', () => {
    expect(service.buildListFilter(query())).toEqual({ deletedAt: null });
  });

  it('combines every given filter, querying references by their ULID', () => {
    const itemId = generateUlid();
    const locationId = generateUlid();

    expect(
      service.buildListFilter(
        query({
          status: ShipmentStatus.CREATED,
          code: 's-0001',
          customerName: 'abc',
          itemId,
          locationId,
        }),
      ),
    ).toEqual({
      deletedAt: null,
      status: 'CREATED',
      code: /s-0001/i,
      customerName: /abc/i,
      itemIds: itemId,
      'deliveryInfos.locationId': locationId,
    });
  });

  it('selects root shipments, segments, or the segments of one parent', () => {
    const parentId = generateUlid();

    expect(service.buildListFilter(query({ isRoot: true }))).toMatchObject({
      parentId: null,
    });
    expect(service.buildListFilter(query({ isRoot: false }))).toMatchObject({
      parentId: { $ne: null },
    });
    expect(
      service.buildListFilter(query({ isRoot: false, parentId })),
    ).toMatchObject({ parentId });
  });

  it('rejects parentId together with isRoot=true', () => {
    expect(() =>
      service.buildListFilter(
        query({ isRoot: true, parentId: generateUlid() }),
      ),
    ).toThrow(BadRequestException);
  });

  it('sorts newest first by default, with the id as tie-breaker', () => {
    expect(service.buildListSort(query())).toEqual({
      createdAt: 'desc',
      id: 'desc',
    });
  });
});
