import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { generateUlid } from '../../common/utils/ulid.util';
import { UpdateAppointmentsDto } from './dto/update-appointments.dto';
import { ShipmentStatus } from './enums/shipment-status.enum';
import {
  appointmentOrderErrors,
  ShipmentEditsService,
} from './shipment-edits.service';

function appointments(
  pickup: [string, string],
  dropoff: [string, string],
): UpdateAppointmentsDto {
  return {
    pickup: { from: new Date(pickup[0]), to: new Date(pickup[1]) },
    dropoff: { from: new Date(dropoff[0]), to: new Date(dropoff[1]) },
  };
}

describe('appointmentOrderErrors', () => {
  it('accepts a pickup that ends exactly when the drop-off starts', () => {
    expect(
      appointmentOrderErrors(
        appointments(
          ['2026-10-27T01:00:00Z', '2026-10-27T03:00:00Z'],
          ['2026-10-27T03:00:00Z', '2026-10-27T05:00:00Z'],
        ),
      ),
    ).toEqual([]);
  });

  it('requires from before to in each window', () => {
    expect(
      appointmentOrderErrors(
        appointments(
          ['2026-10-27T03:00:00Z', '2026-10-27T03:00:00Z'],
          ['2026-10-29T05:00:00Z', '2026-10-29T04:00:00Z'],
        ),
      ),
    ).toEqual([
      'pickup.from must be before pickup.to',
      'dropoff.from must be before dropoff.to',
    ]);
  });

  it('rejects a pickup that ends after the drop-off starts', () => {
    expect(
      appointmentOrderErrors(
        appointments(
          ['2026-10-29T01:00:00Z', '2026-10-29T06:00:00Z'],
          ['2026-10-29T05:00:00Z', '2026-10-29T08:00:00Z'],
        ),
      ),
    ).toEqual(['pickup.to must not be later than dropoff.from']);
  });
});

describe('ShipmentEditsService checks before writing', () => {
  const itemId = generateUlid();
  const root = {
    id: generateUlid(),
    code: 'S-0001-1026',
    status: ShipmentStatus.CREATED,
    itemIds: [itemId],
    childrenIds: [],
    deliveryInfos: [],
  };
  // Every write goes through these; none of them may be called in these tests.
  const shipmentModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const itemsService = {
    findByIds: jest
      .fn()
      .mockResolvedValue([{ id: itemId, weight: 1, weightUnit: 'KG' }]),
    correct: jest.fn(),
  };
  const routesService = {
    setDedicatedRouteAppointment: jest.fn(),
    updateItemSnapshots: jest.fn(),
  };
  const costService = { calculate: jest.fn() };
  const shipmentsService = { findRootById: jest.fn() };
  const service = new ShipmentEditsService(
    shipmentModel as never,
    shipmentsService as never,
    itemsService as never,
    routesService as never,
    costService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    expect(shipmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(shipmentModel.updateOne).not.toHaveBeenCalled();
    expect(itemsService.correct).not.toHaveBeenCalled();
    expect(routesService.setDedicatedRouteAppointment).not.toHaveBeenCalled();
    expect(routesService.updateItemSnapshots).not.toHaveBeenCalled();
  });

  it.each([
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.CANCELLED,
    ShipmentStatus.DELIVERED,
  ])('answers 409 for every PUT when the booking is %s', async (status) => {
    shipmentsService.findRootById.mockResolvedValue({ ...root, status });
    const valid = appointments(
      ['2026-10-27T01:00:00Z', '2026-10-27T03:00:00Z'],
      ['2026-10-29T05:00:00Z', '2026-10-29T08:00:00Z'],
    );

    for (const edit of [
      service.updateCustomer(root.id, { customerName: 'X' }),
      service.updateAppointments(root.id, valid),
      service.updateItem(root.id, itemId, {
        weight: 2,
        weightUnit: 'KG',
      } as never),
    ]) {
      await expect(edit).rejects.toThrow(
        new ConflictException(
          `Booking S-0001-1026 is ${status}; the booking can no longer be edited`,
        ),
      );
    }
  });

  it('rejects windows in the wrong order with 400 before reading the booking', async () => {
    await expect(
      service.updateAppointments(
        root.id,
        appointments(
          ['2026-10-29T01:00:00Z', '2026-10-29T06:00:00Z'],
          ['2026-10-29T05:00:00Z', '2026-10-29T08:00:00Z'],
        ),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(shipmentsService.findRootById).not.toHaveBeenCalled();
  });

  it('answers 404 for an item that is not on the booking', async () => {
    shipmentsService.findRootById.mockResolvedValue(root);
    const otherItem = generateUlid();

    await expect(service.updateItem(root.id, otherItem, {})).rejects.toThrow(
      new NotFoundException(`Item ${otherItem} is not on booking S-0001-1026`),
    );
  });

  it('writes nothing when pricing is not configured', async () => {
    shipmentsService.findRootById.mockResolvedValue(root);
    costService.calculate.mockImplementation(() => {
      throw new ServiceUnavailableException('pricing');
    });

    await expect(
      service.updateItem(root.id, itemId, { weight: 2 }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(costService.calculate).toHaveBeenCalledWith([
      { id: itemId, weight: 2, weightUnit: 'KG' },
    ]);
  });
});
