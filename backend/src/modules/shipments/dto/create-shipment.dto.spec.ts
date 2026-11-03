import { Types } from 'mongoose';
import { validateBody } from '../../../../test/utils/validate-body';
import { TimeWindowDto } from '../../../common/dto/time-window.dto';
import { generateUlid } from '../../../common/utils/ulid.util';
import { CreateItemDto } from '../../items/dto/create-item.dto';
import { DimensionsDto } from '../../items/dto/dimensions.dto';
import { LocationCandidateDto } from '../../locations/dto/location-candidate.dto';
import { CreateShipmentDto } from './create-shipment.dto';
import { ShipmentEndpointDto } from './shipment-endpoint.dto';

function endpoint(name: string, postalCode: string) {
  return {
    location: {
      name,
      contactName: 'Nguyen Van A',
      contactPhone: '0901234567',
      address: { addressLine1: '1 Example Street', postalCode },
    },
    appointment: {
      from: '2026-10-27T08:00:00+07:00',
      to: '2026-10-27T10:00:00+07:00',
    },
  };
}

function item(barcode: string, overrides: Record<string, unknown> = {}) {
  return {
    barcode,
    itemUnit: 'BOX',
    weight: 2.5,
    weightUnit: 'KG',
    ...overrides,
  };
}

function validBody(): Record<string, unknown> {
  return {
    customerName: 'Cong ty TNHH ABC',
    pickup: endpoint('Store A', '100000'),
    dropoff: endpoint('Store B', '700000'),
    items: [item('BC-1')],
  };
}

describe('CreateShipmentDto', () => {
  it('accepts pickup and drop-off locations and returns DTO instances', async () => {
    const { value, errors } = await validateBody(
      CreateShipmentDto,
      validBody(),
    );

    expect(errors).toEqual([]);
    expect(value).toBeInstanceOf(CreateShipmentDto);
    expect(value!.pickup).toBeInstanceOf(ShipmentEndpointDto);
    expect(value!.dropoff.location).toBeInstanceOf(LocationCandidateDto);
  });

  it('trims the location reuse fields', async () => {
    const body = validBody();
    body.pickup = {
      ...endpoint('Store A', '100000'),
      location: {
        name: ' Store A ',
        contactName: ' Nguyen Van A ',
        address: { addressLine1: '1 Example Street', postalCode: ' 100000 ' },
      },
    };

    const { value } = await validateBody(CreateShipmentDto, body);

    expect(value!.pickup.location).toMatchObject({
      name: 'Store A',
      contactName: 'Nguyen Van A',
      address: { postalCode: '100000' },
    });
  });

  it('requires the customer name, both pickup and drop-off, and items', async () => {
    const { errors } = await validateBody(CreateShipmentDto, {});

    expect(errors).toEqual(
      expect.arrayContaining([
        'customerName should not be empty',
        'pickup must be an object',
        'dropoff must be an object',
        'items must be an array',
      ]),
    );
  });

  it('requires at least one item', async () => {
    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      items: [],
    });

    expect(errors).toEqual(['items must contain at least 1 elements']);
  });

  it('trims the customer name and rejects a blank one', async () => {
    const { value } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      customerName: '  Cong ty TNHH ABC ',
    });
    expect(value!.customerName).toBe('Cong ty TNHH ABC');

    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      customerName: '   ',
    });
    expect(errors).toEqual(['customerName should not be empty']);
  });

  it('rejects a client-supplied cost', async () => {
    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      cost: 0,
    });

    expect(errors).toEqual(['property cost should not exist']);
  });

  it('requires every field of the location reuse rule', async () => {
    const body = validBody();
    body.dropoff = {
      ...endpoint('Store B', '700000'),
      location: {
        name: '',
        address: { addressLine1: '2 Example Street' },
      },
    };

    const { errors } = await validateBody(CreateShipmentDto, body);

    expect(errors).toEqual(
      expect.arrayContaining([
        'dropoff.location.name should not be empty',
        'dropoff.location.contactName should not be empty',
        'dropoff.location.address.postalCode should not be empty',
      ]),
    );
  });

  it('reports malformed nested objects with their path', async () => {
    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      pickup: { ...endpoint('Store A', '100000'), location: 'Store A' },
      dropoff: 'Store B',
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'pickup.location must be an object',
        'dropoff must be an object',
      ]),
    );
  });

  it('accepts metadata', async () => {
    const { value, errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      metadata: { source: 'manual' },
    });

    expect(errors).toEqual([]);
    expect(value!.metadata).toEqual({ source: 'manual' });
  });

  it('does not accept references to existing items', async () => {
    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      itemIds: [generateUlid()],
    });

    expect(errors).toEqual(['property itemIds should not exist']);
  });

  it.each([
    '_id',
    'id',
    'code',
    'status',
    'parentId',
    'childrenIds',
    'deliveryInfos',
    'routeId',
    'routeIds',
    'stops',
    'originLocationId',
    'destinationLocationId',
  ])('rejects the server-controlled field %s', async (field) => {
    const { errors } = await validateBody(CreateShipmentDto, {
      ...validBody(),
      [field]: 'value',
    });

    expect(errors).toEqual([`property ${field} should not exist`]);
  });

  it('rejects location references and fields the workflow decides', async () => {
    const body = validBody();
    body.pickup = {
      ...endpoint('Store A', '100000'),
      locationId: new Types.ObjectId().toString(),
    };
    body.dropoff = {
      ...endpoint('Store B', '700000'),
      location: {
        ...endpoint('Store B', '700000').location,
        _id: new Types.ObjectId().toString(),
        type: 'CROSS_DOCK',
        status: 'ACTIVE',
      },
    };

    const { errors } = await validateBody(CreateShipmentDto, body);

    expect(errors.sort()).toEqual(
      [
        'pickup.property locationId should not exist',
        'dropoff.location.property _id should not exist',
        'dropoff.location.property type should not exist',
        'dropoff.location.property status should not exist',
      ].sort(),
    );
  });

  describe('appointments', () => {
    it('converts the ISO date-times to Date instances', async () => {
      const { value, errors } = await validateBody(
        CreateShipmentDto,
        validBody(),
      );

      expect(errors).toEqual([]);
      expect(value!.pickup.appointment).toBeInstanceOf(TimeWindowDto);
      expect(value!.pickup.appointment.from).toEqual(
        new Date('2026-10-27T01:00:00Z'),
      );
      expect(value!.dropoff.appointment.to).toBeInstanceOf(Date);
    });

    it('requires an appointment for both endpoints', async () => {
      const body = validBody();
      body.pickup = { location: endpoint('Store A', '100000').location };
      body.dropoff = {
        ...endpoint('Store B', '700000'),
        appointment: 'tomorrow',
      };

      const { errors } = await validateBody(CreateShipmentDto, body);

      expect(errors).toEqual(
        expect.arrayContaining([
          'pickup.appointment must be an object',
          'dropoff.appointment must be an object',
        ]),
      );
    });

    it('requires both ends of the window as valid dates', async () => {
      const body = validBody();
      body.pickup = {
        ...endpoint('Store A', '100000'),
        appointment: { from: 'not-a-date' },
      };

      const { errors } = await validateBody(CreateShipmentDto, body);

      expect(errors.sort()).toEqual([
        'pickup.appointment.from must be a Date instance',
        'pickup.appointment.to must be a Date instance',
      ]);
    });

    it('rejects a window that ends before it starts', async () => {
      const body = validBody();
      body.dropoff = {
        ...endpoint('Store B', '700000'),
        appointment: {
          from: '2026-10-27T10:00:00Z',
          to: '2026-10-27T09:59:59Z',
        },
      };

      const { errors } = await validateBody(CreateShipmentDto, body);

      expect(errors).toEqual([
        'dropoff.appointment.to must not be earlier than from',
      ]);
    });

    it('accepts a window whose ends are equal', async () => {
      const body = validBody();
      body.pickup = {
        ...endpoint('Store A', '100000'),
        appointment: {
          from: '2026-10-27T10:00:00Z',
          to: '2026-10-27T10:00:00Z',
        },
      };

      expect((await validateBody(CreateShipmentDto, body)).errors).toEqual([]);
    });
  });

  describe('items', () => {
    it('accepts item details and returns DTO instances', async () => {
      const { value, errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: [
          item(' BC-1 ', {
            description: 'Books',
            dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
            metadata: { fragile: true },
          }),
          item('BC-2', { itemUnit: 'PALLET', weightUnit: 'LB' }),
        ],
      });

      expect(errors).toEqual([]);
      expect(value!.items[0]).toBeInstanceOf(CreateItemDto);
      expect(value!.items[0].barcode).toBe('BC-1');
      expect(value!.items[0].dimensions).toBeInstanceOf(DimensionsDto);
      expect(value!.items.map((i) => i.itemUnit)).toEqual(['BOX', 'PALLET']);
    });

    it('requires a barcode, a known item unit, a positive weight, and a known weight unit', async () => {
      const { errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: [
          { barcode: ' ', itemUnit: 'CRATE', weight: 0, weightUnit: 'G' },
          {},
        ],
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          'items.0.barcode should not be empty',
          'items.0.itemUnit must be one of the following values: BOX, PALLET, KEG, BAG',
          'items.0.weight must be a positive number',
          'items.0.weightUnit must be one of the following values: KG, LB',
          'items.1.barcode should not be empty',
          'items.1.itemUnit must be one of the following values: BOX, PALLET, KEG, BAG',
          'items.1.weight must be a positive number',
        ]),
      );
    });

    it('requires complete, positive dimensions when given', async () => {
      const { errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: [item('BC-1', { dimensions: { length: 40, width: -1 } })],
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          'items.0.dimensions.width must be a positive number',
          'items.0.dimensions.height must be a positive number',
          'items.0.dimensions.unit must be one of the following values: CM, IN',
        ]),
      );
    });

    it('rejects two items with the same barcode', async () => {
      const { errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: [item('BC-1'), item(' BC-1')],
      });

      expect(errors).toEqual([
        'Each item in items must have a different barcode',
      ]);
    });

    it.each([
      'id',
      'itemCode',
      'status',
      'currentLocationId',
      'currentShipmentId',
    ])('rejects the system-assigned item field %s', async (field) => {
      const { errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: [item('BC-1', { [field]: 'value' })],
      });

      expect(errors).toEqual([`items.0.property ${field} should not exist`]);
    });

    it('requires items to be an array', async () => {
      const { errors } = await validateBody(CreateShipmentDto, {
        ...validBody(),
        items: item('BC-1'),
      });

      expect(errors).toContain('items must be an array');
    });
  });
});
