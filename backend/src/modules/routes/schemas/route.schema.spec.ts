import { Mongoose, Types } from 'mongoose';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { RouteStatus } from '../enums/route-status.enum';
import { RouteStopSchema } from './route-stop.schema';
import { Route, RouteSchema } from './route.schema';

const RouteModel = new Mongoose().model<Route>(Route.name, RouteSchema);

function stop(sequence: number, type: DeliveryPointType) {
  return { sequence, type, locationId: generateUlid() };
}

function validRouteInput() {
  return {
    routeNumber: 'R-0001-1026',
    createdBy: generateUlid(),
    stops: [
      stop(1, DeliveryPointType.PICKUP),
      stop(2, DeliveryPointType.DROPOFF),
    ],
  };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new RouteModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('RouteSchema', () => {
  describe('definition', () => {
    it('maps to the routes collection with timestamps enabled', () => {
      expect(RouteSchema.get('collection')).toBe('routes');
      expect(RouteSchema.get('timestamps')).toBe(true);
    });

    it('declares unique id and routeNumber plus shipment and status query indexes', () => {
      const indexes = RouteSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique === true,
      }));

      expect(indexes).toEqual(
        expect.arrayContaining([
          { fields: { id: 1 }, unique: true },
          { fields: { routeNumber: 1 }, unique: true },
          { fields: { shipmentIds: 1 }, unique: false },
          { fields: { status: 1, 'appointment.from': 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });

    it('generates id with the shared ULID utility', () => {
      expect(RouteSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
      });
    });

    it('references shipments, users, and locations by their ULID id', () => {
      const ulidArray = { type: [{ type: String, validate: ulidValidator }] };

      expect(RouteSchema.path('shipmentIds').options).toMatchObject(ulidArray);
      expect(RouteStopSchema.path('shipmentIds').options).toMatchObject(
        ulidArray,
      );
      expect(RouteSchema.path('createdBy').options).toMatchObject({
        type: String,
        required: true,
        validate: ulidValidator,
      });
      expect(RouteStopSchema.path('locationId').options).toMatchObject({
        type: String,
        required: true,
        validate: ulidValidator,
      });
    });

    it('rejects ObjectIds in every reference', () => {
      const objectId = new Types.ObjectId().toString();

      expect(
        validationErrorPaths({
          routeNumber: 'R-0001-1026',
          createdBy: objectId,
          shipmentIds: [objectId],
          stops: [
            {
              sequence: 1,
              type: DeliveryPointType.PICKUP,
              locationId: objectId,
              shipmentIds: [objectId],
            },
          ],
        }),
      ).toEqual([
        'createdBy',
        'shipmentIds.0',
        'stops.0.locationId',
        'stops.0.shipmentIds.0',
      ]);
    });

    it('embeds stops without an _id and has no duplicate planned/actual fields', () => {
      expect(RouteStopSchema.path('_id')).toBeUndefined();
      for (const field of [
        'plannedStartAt',
        'plannedEndAt',
        'actualStartAt',
        'actualEndAt',
      ]) {
        expect(RouteSchema.path(field)).toBeUndefined();
      }
    });

    it('allows exactly the documented route and stop statuses', () => {
      expect(RouteSchema.path('status').options).toMatchObject({
        enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
        default: RouteStatus.PLANNED,
      });
      expect(RouteStopSchema.path('status').options).toMatchObject({
        enum: ['PENDING', 'ARRIVED', 'PROCESSING', 'COMPLETED', 'SKIPPED'],
        default: DeliveryPointStatus.PENDING,
      });
      expect(RouteStopSchema.path('type').options).toMatchObject({
        enum: ['PICKUP', 'TRANSIT', 'DROPOFF'],
      });
    });
  });

  describe('new documents', () => {
    it('applies route and stop defaults', () => {
      const route = new RouteModel(validRouteInput());
      const stored = route.toObject();

      expect(route.validateSync()).toBeUndefined();
      expect(stored).toMatchObject({
        status: RouteStatus.PLANNED,
        shipmentIds: [],
        appointment: { from: null, to: null },
        actualWindow: { from: null, to: null },
      });
      expect(stored.stops[0]).toMatchObject({
        status: DeliveryPointStatus.PENDING,
        shipmentIds: [],
        appointment: { from: null, to: null },
        actualWindow: { from: null, to: null },
      });
    });
  });

  describe('validation', () => {
    it('requires routeNumber and createdBy', () => {
      expect(validationErrorPaths({})).toEqual(['createdBy', 'routeNumber']);
    });

    it('requires routeNumber in the R-<nnnn>-MMYY format', () => {
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          routeNumber: 'R-0007-1026',
        }),
      ).toEqual([]);
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          routeNumber: 'R-0007-1326',
        }),
      ).toEqual(['routeNumber']);
    });

    it('is not soft-deleted by default', () => {
      expect(new RouteModel(validRouteInput()).deletedAt).toBeNull();
    });

    it('requires sequence, locationId, and a supported type for each stop', () => {
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          stops: [{ type: 'DEPOT', status: 'DONE' }],
        }),
      ).toEqual([
        'stops.0.locationId',
        'stops.0.sequence',
        'stops.0.status',
        'stops.0.type',
      ]);
    });

    it('rejects repeated stop sequence numbers', () => {
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          stops: [
            stop(1, DeliveryPointType.PICKUP),
            stop(1, DeliveryPointType.DROPOFF),
          ],
        }),
      ).toEqual(['stops']);
    });

    it('rejects an appointment that ends before it starts', () => {
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          appointment: {
            from: new Date('2026-10-18T10:00:00Z'),
            to: new Date('2026-10-18T08:00:00Z'),
          },
        }),
      ).toEqual(['appointment.from', 'appointment.to']);
    });
  });
});
