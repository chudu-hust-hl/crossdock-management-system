import { validateBody } from '../../../../test/utils/validate-body';
import { DimensionsDto } from './dimensions.dto';
import { UpdateItemDto } from './update-item.dto';

describe('UpdateItemDto', () => {
  it('accepts every correctable field and returns DTO instances', async () => {
    const { value, errors } = await validateBody(UpdateItemDto, {
      description: ' Carton of books ',
      itemUnit: 'PALLET',
      weight: 3,
      weightUnit: 'LB',
      dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
    });

    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      description: 'Carton of books',
      itemUnit: 'PALLET',
      weight: 3,
      weightUnit: 'LB',
    });
    expect(value!.dimensions).toBeInstanceOf(DimensionsDto);
  });

  it('accepts an empty body and null to clear the description', async () => {
    expect((await validateBody(UpdateItemDto, {})).errors).toEqual([]);

    const { value, errors } = await validateBody(UpdateItemDto, {
      description: null,
    });
    expect(errors).toEqual([]);
    expect(value!.description).toBeNull();
  });

  it('requires weightUnit when weight is sent, and a positive weight', async () => {
    expect((await validateBody(UpdateItemDto, { weight: 2 })).errors).toEqual([
      'weightUnit must be one of the following values: KG, LB',
    ]);
    expect(
      (await validateBody(UpdateItemDto, { weight: 0, weightUnit: 'KG' }))
        .errors,
    ).toEqual(['weight must be a positive number']);
  });

  it('rejects null for the fields that cannot be removed', async () => {
    const { errors } = await validateBody(UpdateItemDto, {
      itemUnit: null,
      weight: null,
      weightUnit: null,
      dimensions: null,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'itemUnit must be one of the following values: BOX, PALLET, KEG, BAG',
        'weight must be a positive number',
        'weightUnit must be one of the following values: KG, LB',
        'dimensions must be an object',
      ]),
    );
  });

  it('rejects an empty description and incomplete dimensions', async () => {
    const { errors } = await validateBody(UpdateItemDto, {
      description: '   ',
      dimensions: { length: 40 },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'description should not be empty',
        'dimensions.width must be a positive number',
      ]),
    );
  });

  it.each([
    'barcode',
    'itemCode',
    'status',
    'currentLocationId',
    'currentShipmentId',
  ])('rejects the field %s', async (field) => {
    const { errors } = await validateBody(UpdateItemDto, { [field]: 'X' });

    expect(errors).toEqual([`property ${field} should not exist`]);
  });
});
