import { validateBody } from '../../../../test/utils/validate-body';
import { LocationStatus } from '../enums/location-status.enum';
import { LocationType } from '../enums/location-type.enum';
import { AddressDto } from './address.dto';
import { CreateLocationDto } from './create-location.dto';

function validBody(): Record<string, unknown> {
  return {
    name: 'Hanoi Cross-Dock',
    type: LocationType.CROSS_DOCK,
    address: { addressLine1: '1 Dai Co Viet', postalCode: '100000' },
  };
}

describe('CreateLocationDto', () => {
  it('accepts a cross-dock location and returns DTO instances', async () => {
    const { value, errors } = await validateBody(
      CreateLocationDto,
      validBody(),
    );

    expect(errors).toEqual([]);
    expect(value).toBeInstanceOf(CreateLocationDto);
    expect(value!.address).toBeInstanceOf(AddressDto);
    expect(value!.status).toBeUndefined();
  });

  it.each(Object.values(LocationType))('accepts type %s', async (type) => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      type,
      contactName: 'Nguyen Van A',
    });

    expect(errors).toEqual([]);
  });

  it('requires contactName for a STORE, which the reuse rule needs', async () => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      type: LocationType.STORE,
    });

    expect(errors).toContain('contactName should not be empty');
  });

  it('keeps contactName optional for other types, but not blank when given', async () => {
    expect((await validateBody(CreateLocationDto, validBody())).errors).toEqual(
      [],
    );
    expect(
      (
        await validateBody(CreateLocationDto, {
          ...validBody(),
          contactName: '   ',
        })
      ).errors,
    ).toEqual(['contactName should not be empty']);
  });

  it('accepts the optional fields', async () => {
    const { value, errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      contactName: 'Tran Van D',
      contactPhone: '+84 24 1234 5678',
      status: LocationStatus.INACTIVE,
      metadata: { doorCount: 12 },
      address: {
        addressLine1: '1 Dai Co Viet',
        addressLine2: 'Gate 2',
        ward: 'Bach Khoa',
        district: 'Hai Ba Trung',
        city: 'Hanoi',
        province: 'Hanoi',
        postalCode: '100000',
        country: 'VN',
      },
    });

    expect(errors).toEqual([]);
    expect(value!.metadata).toEqual({ doorCount: 12 });
  });

  it('trims string values', async () => {
    const { value } = await validateBody(CreateLocationDto, {
      ...validBody(),
      name: '  Hanoi Cross-Dock ',
      contactName: ' Tran Van D ',
      address: { addressLine1: ' 1 Dai Co Viet ', postalCode: ' 100000 ' },
    });

    expect(value!.name).toBe('Hanoi Cross-Dock');
    expect(value!.contactName).toBe('Tran Van D');
    expect(value!.address.addressLine1).toBe('1 Dai Co Viet');
    expect(value!.address.postalCode).toBe('100000');
  });

  it('requires name, type, and address', async () => {
    const { errors } = await validateBody(CreateLocationDto, {});

    expect(errors).toEqual(
      expect.arrayContaining([
        'name should not be empty',
        'type must be one of the following values: WAREHOUSE, CROSS_DOCK, STORE, CUSTOMER',
        'address must be an object',
      ]),
    );
  });

  it('rejects a blank name and the removed DOCK type', async () => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      name: '   ',
      type: 'DOCK',
    });

    expect(errors).toEqual([
      'name should not be empty',
      'type must be one of the following values: WAREHOUSE, CROSS_DOCK, STORE, CUSTOMER',
    ]);
  });

  it('rejects an unsupported status', async () => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      status: 'DELETED',
    });

    expect(errors).toEqual([
      'status must be one of the following values: ACTIVE, INACTIVE',
    ]);
  });

  it('validates the nested address', async () => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      address: { addressLine1: '', postalCode: '  ', city: 42 },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'address.addressLine1 should not be empty',
        'address.postalCode should not be empty',
        'address.city must be a string',
      ]),
    );
  });

  it('rejects an address that is not an object', async () => {
    const { errors } = await validateBody(CreateLocationDto, {
      ...validBody(),
      address: '1 Dai Co Viet, Hanoi',
    });

    expect(errors).toContain('address must be an object');
  });

  it.each(['_id', 'id', 'locationCode', 'createdAt', 'updatedAt', 'deletedAt'])(
    'rejects the server-controlled or unknown field %s',
    async (field) => {
      const { errors } = await validateBody(CreateLocationDto, {
        ...validBody(),
        [field]: 'value',
      });

      expect(errors).toEqual([`property ${field} should not exist`]);
    },
  );
});
