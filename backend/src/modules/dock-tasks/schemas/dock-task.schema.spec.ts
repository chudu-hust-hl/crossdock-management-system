import { Mongoose, Types } from 'mongoose';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { DockTaskStatus } from '../enums/dock-task-status.enum';
import { DockTaskType } from '../enums/dock-task-type.enum';
import { DockTask, DockTaskSchema } from './dock-task.schema';

const REFERENCE_FIELDS = [
  'itemId',
  'shipmentId',
  'routeId',
  'locationId',
  'inboundLegId',
  'outboundLegId',
  'performedBy',
];

const DockTaskModel = new Mongoose().model<DockTask>(
  DockTask.name,
  DockTaskSchema,
);

function validDockTaskInput() {
  return {
    taskNumber: '0001-1026',
    itemId: generateUlid(),
    shipmentId: generateUlid(),
    routeId: generateUlid(),
    locationId: generateUlid(),
    type: DockTaskType.SCAN_INBOUND,
  };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new DockTaskModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('DockTaskSchema', () => {
  describe('definition', () => {
    it('maps to the dock_tasks collection with timestamps enabled', () => {
      expect(DockTaskSchema.get('collection')).toBe('dock_tasks');
      expect(DockTaskSchema.get('timestamps')).toBe(true);
    });

    it('declares unique id and taskNumber plus item, route, and shipment query indexes', () => {
      const indexes = DockTaskSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique === true,
      }));

      expect(indexes).toEqual(
        expect.arrayContaining([
          { fields: { id: 1 }, unique: true },
          { fields: { taskNumber: 1 }, unique: true },
          { fields: { itemId: 1, createdAt: -1 }, unique: false },
          {
            fields: { routeId: 1, locationId: 1, status: 1 },
            unique: false,
          },
          { fields: { shipmentId: 1, type: 1, status: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(5);
    });

    it('generates id with the shared ULID utility', () => {
      expect(DockTaskSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
      });
    });

    it('references each related document by its ULID id', () => {
      for (const field of REFERENCE_FIELDS) {
        expect(DockTaskSchema.path(field).instance).toBe('String');
        expect(DockTaskSchema.path(field).options).toMatchObject({
          validate: ulidValidator,
        });
        expect(DockTaskSchema.path(field).options.ref).toBeUndefined();
      }
    });

    it('rejects ObjectIds in every reference', () => {
      const objectId = new Types.ObjectId().toString();
      const input = Object.fromEntries(
        REFERENCE_FIELDS.map((field) => [field, objectId]),
      );

      expect(
        validationErrorPaths({ ...validDockTaskInput(), ...input }),
      ).toEqual([...REFERENCE_FIELDS].sort());
    });

    it('holds exactly one item and uses full inbound/outbound names', () => {
      for (const field of ['itemIds', 'inLegId', 'outLegId']) {
        expect(DockTaskSchema.path(field)).toBeUndefined();
      }
    });

    it('allows exactly the documented task types and statuses', () => {
      expect(DockTaskSchema.path('type').options).toMatchObject({
        enum: [
          'SCAN_INBOUND',
          'SCAN_OUTBOUND',
          'PHOTO',
          'INSPECTION',
          'EXCEPTION',
        ],
        required: true,
      });
      expect(DockTaskSchema.path('status').options).toMatchObject({
        enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'],
        default: DockTaskStatus.PENDING,
      });
    });
  });

  describe('new documents', () => {
    it('defaults to PENDING with nullable references and completion time unset', () => {
      const task = new DockTaskModel(validDockTaskInput());

      expect(task.validateSync()).toBeUndefined();
      expect(task.status).toBe(DockTaskStatus.PENDING);
      expect(task.inboundLegId).toBeNull();
      expect(task.outboundLegId).toBeNull();
      expect(task.performedBy).toBeNull();
      expect(task.completedAt).toBeNull();
      expect(task.deletedAt).toBeNull();
    });

    it('requires taskNumber in the <nnnn>-MMYY format', () => {
      expect(
        validationErrorPaths({
          ...validDockTaskInput(),
          taskNumber: '1024-1026',
        }),
      ).toEqual([]);
      expect(
        validationErrorPaths({
          ...validDockTaskInput(),
          taskNumber: 'DT-1024',
        }),
      ).toEqual(['taskNumber']);
    });

    it('does not require both leg references', () => {
      expect(
        validationErrorPaths({
          ...validDockTaskInput(),
          inboundLegId: generateUlid(),
        }),
      ).toEqual([]);
    });
  });

  describe('validation', () => {
    it('requires taskNumber, type, and the item, shipment, route, and location references', () => {
      expect(validationErrorPaths({})).toEqual([
        'itemId',
        'locationId',
        'routeId',
        'shipmentId',
        'taskNumber',
        'type',
      ]);
    });

    it('rejects unsupported types and statuses', () => {
      expect(
        validationErrorPaths({
          ...validDockTaskInput(),
          type: 'SCAN_IN',
          status: 'DONE',
        }),
      ).toEqual(['status', 'type']);
    });
  });
});
