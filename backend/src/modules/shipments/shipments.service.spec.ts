import { BadRequestException } from '@nestjs/common';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { generateUlid } from '../../common/utils/ulid.util';
import { ItemUnit } from '../items/enums/item-unit.enum';
import { WeightUnit } from '../items/enums/weight-unit.enum';
import { LocationType } from '../locations/enums/location-type.enum';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { toShipmentPageResponse } from './dto/shipment-summary-response.dto';
import { ShipmentStatus } from './enums/shipment-status.enum';
import { Shipment } from './schemas/shipment.schema';
import { ShipmentsService } from './shipments.service';

function query(fields: Partial<ListShipmentsQueryDto> = {}) {
  return Object.assign(new ListShipmentsQueryDto(), fields);
}

describe('ShipmentsService list query', () => {
  // The filter and sort builders use none of the injected dependencies.
  const unused = {} as never;
  const service = new ShipmentsService(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
  );

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

describe('ShipmentsService summary page', () => {
  const storeA = generateUlid();
  const storeB = generateUlid();
  const hub = generateUlid();
  const [item1, item2, item3] = [
    generateUlid(),
    generateUlid(),
    generateUlid(),
  ];

  function shipment(
    code: string,
    itemIds: string[],
    locationIds: string[],
  ): Shipment {
    return {
      id: generateUlid(),
      code,
      parentId: null,
      childrenIds: [],
      customerName: 'Cong ty ABC',
      cost: 40500,
      itemIds,
      status: ShipmentStatus.CREATED,
      deliveryInfos: locationIds.map((locationId, index) => ({
        sequence: index + 1,
        locationId,
        type:
          index === 0
            ? DeliveryPointType.PICKUP
            : index === locationIds.length - 1
              ? DeliveryPointType.DROPOFF
              : DeliveryPointType.TRANSIT,
        appointment: {
          from: new Date('2026-10-27T01:00:00Z'),
          to: new Date('2026-10-27T03:00:00Z'),
        },
        actualWindow: { from: null, to: null },
        status: DeliveryPointStatus.PENDING,
      })),
      deletedAt: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    };
  }

  const routed = shipment('S-0001-1026', [item2, item1], [storeA, hub, storeB]);
  const direct = shipment('S-0002-1026', [item3], [storeA, storeB]);

  const locationsService = {
    findSummariesByIds: jest.fn().mockResolvedValue([
      {
        id: storeA,
        name: 'Store A',
        type: LocationType.STORE,
        address: { province: 'Hanoi' },
      },
    ]),
  };
  const itemsService = {
    findSummariesByIds: jest.fn().mockResolvedValue([
      {
        id: item1,
        itemCode: 'T-0001-1026',
        itemUnit: ItemUnit.BOX,
        weight: 2.5,
        weightUnit: WeightUnit.KG,
      },
      {
        id: item2,
        itemCode: 'T-0002-1026',
        itemUnit: ItemUnit.PALLET,
        weight: 1,
        weightUnit: WeightUnit.KG,
      },
    ]),
  };
  const unused = {} as never;
  const service = new ShipmentsService(
    unused,
    locationsService as never,
    itemsService as never,
    unused,
    unused,
    unused,
    unused,
  );

  beforeAll(() => {
    jest.spyOn(service, 'findAll').mockResolvedValue({
      items: [routed, direct],
      page: 1,
      limit: 20,
      total: 2,
    });
  });

  it('reads the stores and the Items of the whole page in one batch each', async () => {
    await service.findSummaryPage(query({ isRoot: true }));

    expect(locationsService.findSummariesByIds).toHaveBeenCalledTimes(1);
    expect(locationsService.findSummariesByIds).toHaveBeenCalledWith([
      storeA,
      storeB,
    ]);
    expect(itemsService.findSummariesByIds).toHaveBeenCalledTimes(1);
    expect(itemsService.findSummariesByIds).toHaveBeenCalledWith([
      item2,
      item1,
      item3,
    ]);
  });

  it('maps each row to its stores, appointments, items and routing state', async () => {
    const page = toShipmentPageResponse(
      await service.findSummaryPage(query({ isRoot: true })),
    );

    expect(page).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(page.items[0]).toEqual({
      id: routed.id,
      code: 'S-0001-1026',
      status: 'CREATED',
      customerName: 'Cong ty ABC',
      cost: 40500,
      createdAt: routed.createdAt,
      origin: { id: storeA, name: 'Store A', type: 'STORE', province: 'Hanoi' },
      // Store B was not found: the id stays, the details are null.
      destination: { id: storeB, name: null, type: null, province: null },
      pickupAppointment: routed.deliveryInfos[0].appointment,
      dropoffAppointment: routed.deliveryInfos[2].appointment,
      items: [
        {
          id: item2,
          itemCode: 'T-0002-1026',
          itemUnit: 'PALLET',
          weight: 1,
          weightUnit: 'KG',
        },
        {
          id: item1,
          itemCode: 'T-0001-1026',
          itemUnit: 'BOX',
          weight: 2.5,
          weightUnit: 'KG',
        },
      ],
      routed: true,
    });
    expect(page.items[1]).toMatchObject({ routed: false, items: [] });
  });

  it('gives a leg without a PICKUP point no origin and an empty pickup window', () => {
    const leg = shipment('S-0003-1026', [], [hub, storeB]);
    leg.deliveryInfos[0].type = DeliveryPointType.TRANSIT;

    const page = toShipmentPageResponse({
      page: { items: [leg], page: 1, limit: 20, total: 1 },
      locations: [],
      items: [],
    });

    expect(page.items[0]).toMatchObject({
      origin: null,
      pickupAppointment: { from: null, to: null },
      destination: { id: storeB, name: null },
    });
  });
});
