import { Mongoose, Types } from 'mongoose';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { RouteStatus } from '../enums/route-status.enum';
import {
  ROUTE_CREATED_BY,
  ROUTE_DRIVER_NAME,
  ROUTE_VEHICLE_PLATE,
} from '../route-assignment.constants';
import { RouteItemSchema } from './route-item.schema';
import { RouteStopSchema } from './route-stop.schema';
import { Route, RouteSchema } from './route.schema';

const RouteModel = new Mongoose().model<Route>(Route.name, RouteSchema);

function stop(sequence: number, type: DeliveryPointType) {
  return { sequence, type, locationId: generateUlid() };
}

function validRouteInput() {
  return {
    routeNumber: 'R-0001-1026',
    fromLocationId: generateUlid(),
    toLocationId: generateUlid(),
    driverName: ROUTE_DRIVER_NAME,
    vehiclePlate: ROUTE_VEHICLE_PLATE,
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
          {
            fields: {
              fromLocationId: 1,
              toLocationId: 1,
              serviceDate: 1,
              slot: 1,
            },
            unique: true,
          },
        ]),
      );
      expect(indexes).toHaveLength(5);
      const lane = RouteSchema.indexes().find(
        ([fields]) => fields.slot === 1 && fields.fromLocationId === 1,
      );
      expect(lane?.[1]).toMatchObject({
        unique: true,
        partialFilterExpression: { slot: { $exists: true }, deletedAt: null },
      });
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
      expect(RouteSchema.path('fromLocationId').options).toMatchObject({
        type: String,
        required: true,
        validate: ulidValidator,
      });
      expect(RouteSchema.path('toLocationId').options).toMatchObject({
        type: String,
        required: true,
        validate: ulidValidator,
      });
      expect(RouteItemSchema.path('itemId').options).toMatchObject({
        type: String,
        required: true,
        validate: ulidValidator,
      });
      expect(RouteItemSchema.path('shipmentId').options).toMatchObject({
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
          fromLocationId: objectId,
          toLocationId: objectId,
          driverName: ROUTE_DRIVER_NAME,
          vehiclePlate: ROUTE_VEHICLE_PLATE,
          shipmentIds: [objectId],
          items: [
            {
              itemId: objectId,
              shipmentId: objectId,
              itemCode: 'T-0001-1026',
              barcode: 'B-1',
              itemUnit: 'BOX',
              weight: 1,
              weightUnit: 'KG',
            },
          ],
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
        'fromLocationId',
        'items.0.itemId',
        'items.0.shipmentId',
        'shipmentIds.0',
        'stops.0.locationId',
        'stops.0.shipmentIds.0',
        'toLocationId',
      ]);
    });

    it('embeds stops and item snapshots without an _id and has no duplicate planned/actual fields', () => {
      expect(RouteStopSchema.path('_id')).toBeUndefined();
      expect(RouteItemSchema.path('_id')).toBeUndefined();
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
        items: [],
        appointment: { from: null, to: null },
        actualWindow: { from: null, to: null },
      });
      expect(stored.serviceDate).toBeUndefined();
      expect(stored.slot).toBeUndefined();
      expect(stored.stops[0]).toMatchObject({
        status: DeliveryPointStatus.PENDING,
        shipmentIds: [],
        appointment: { from: null, to: null },
        actualWindow: { from: null, to: null },
      });
    });
  });

  describe('validation', () => {
    it('requires routeNumber, the two ends, the driver, the vehicle, and createdBy', () => {
      expect(validationErrorPaths({})).toEqual([
        'createdBy',
        'driverName',
        'fromLocationId',
        'routeNumber',
        'toLocationId',
        'vehiclePlate',
      ]);
    });

    it('accepts the booking placeholders and a dock-dock slot', () => {
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          createdBy: ROUTE_CREATED_BY,
          serviceDate: '2026-11-07',
          slot: 'MORNING',
        }),
      ).toEqual([]);
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          serviceDate: '2026-11-07',
          slot: 'NIGHT',
        }),
      ).toEqual(['slot']);
      expect(
        validationErrorPaths({
          ...validRouteInput(),
          slot: 'MORNING',
        }),
      ).toEqual(['serviceDate']);
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
