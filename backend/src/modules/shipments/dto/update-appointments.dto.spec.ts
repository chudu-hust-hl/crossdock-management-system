import { validateBody } from '../../../../test/utils/validate-body';
import { UpdateAppointmentsDto } from './update-appointments.dto';
import { UpdateShipmentCustomerDto } from './update-shipment-customer.dto';

describe('UpdateAppointmentsDto', () => {
  const pickup = {
    from: '2026-10-27T08:00:00+07:00',
    to: '2026-10-27T10:00:00+07:00',
  };
  const dropoff = {
    from: '2026-10-29T13:00:00+07:00',
    to: '2026-10-29T17:00:00+07:00',
  };

  it('converts both windows to dates', async () => {
    const { value, errors } = await validateBody(UpdateAppointmentsDto, {
      pickup,
      dropoff,
    });

    expect(errors).toEqual([]);
    expect(value!.pickup.from).toEqual(new Date('2026-10-27T01:00:00Z'));
    expect(value!.dropoff.to).toBeInstanceOf(Date);
  });

  it('requires both windows with valid date-times', async () => {
    const { errors } = await validateBody(UpdateAppointmentsDto, {
      pickup: { from: 'soon', to: pickup.to },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'pickup.from must be a Date instance',
        'dropoff must be an object',
      ]),
    );
  });

  it('rejects other fields', async () => {
    const { errors } = await validateBody(UpdateAppointmentsDto, {
      pickup,
      dropoff,
      transit: pickup,
    });

    expect(errors).toEqual(['property transit should not exist']);
  });
});

describe('UpdateShipmentCustomerDto', () => {
  it('trims the name and rejects a blank one or other fields', async () => {
    const { value } = await validateBody(UpdateShipmentCustomerDto, {
      customerName: ' Cong ty ABC ',
    });
    expect(value!.customerName).toBe('Cong ty ABC');

    expect(
      (await validateBody(UpdateShipmentCustomerDto, { customerName: ' ' }))
        .errors,
    ).toEqual(['customerName should not be empty']);
    expect(
      (
        await validateBody(UpdateShipmentCustomerDto, {
          customerName: 'ABC',
          cost: 1,
        })
      ).errors,
    ).toEqual(['property cost should not exist']);
  });
});
