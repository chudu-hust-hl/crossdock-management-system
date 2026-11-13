import { Mongoose } from 'mongoose';
import { generateUlid } from '../../../common/utils/ulid.util';
import { UserRole } from '../enums/user-role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { User, UserSchema } from './user.schema';

const UserModel = new Mongoose().model<User>(User.name, UserSchema);

function validUserInput() {
  return { fullName: 'Nguyen Van A', email: 'staff@example.com' };
}

function validationErrorPaths(input: Record<string, unknown>): string[] {
  const error = new UserModel(input).validateSync();
  return error ? Object.keys(error.errors).sort() : [];
}

describe('UserSchema', () => {
  describe('definition', () => {
    it('maps to the users collection with timestamps enabled', () => {
      expect(UserSchema.get('collection')).toBe('users');
      expect(UserSchema.get('timestamps')).toBe(true);
    });

    it('declares unique indexes on id and email only', () => {
      const indexes = UserSchema.indexes().map(([fields, options]) => ({
        fields,
        unique: options.unique === true,
      }));

      expect(indexes).toEqual([
        { fields: { id: 1 }, unique: true },
        { fields: { email: 1 }, unique: true },
      ]);
    });

    it('generates id with the shared ULID utility', () => {
      expect(UserSchema.path('id').options).toMatchObject({
        default: generateUlid,
        immutable: true,
        required: true,
      });
    });

    it('excludes passwordHash from queries by default', () => {
      expect(UserSchema.path('passwordHash').options).toMatchObject({
        select: false,
      });
      expect(UserSchema.path('password')).toBeUndefined();
    });
  });

  describe('new documents', () => {
    it('accepts a valid user and applies defaults', () => {
      const user = new UserModel(validUserInput());

      expect(user.validateSync()).toBeUndefined();
      expect(user.roles).toEqual([]);
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.deletedAt).toBeNull();
    });

    it('stores email trimmed and lower-cased', () => {
      const user = new UserModel({
        ...validUserInput(),
        email: '  Staff@Example.COM ',
      });

      expect(user.email).toBe('staff@example.com');
    });

    it('accepts every defined role', () => {
      expect(
        validationErrorPaths({
          ...validUserInput(),
          roles: Object.values(UserRole),
        }),
      ).toEqual([]);
    });
  });

  describe('validation', () => {
    it('requires fullName and email and rejects blank values', () => {
      expect(validationErrorPaths({})).toEqual(['email', 'fullName']);
      expect(validationErrorPaths({ fullName: '  ', email: ' ' })).toEqual([
        'email',
        'fullName',
      ]);
    });

    it('allows exactly the four agreed roles', () => {
      expect(Object.values(UserRole)).toEqual([
        'SYS_ADMIN',
        'ADMIN',
        'DOCK_MANAGER',
        'DOCK_OPERATOR',
      ]);
    });

    it('rejects unsupported and retired roles, and unsupported statuses', () => {
      expect(
        validationErrorPaths({
          ...validUserInput(),
          roles: [
            UserRole.ADMIN,
            'SUPERUSER',
            'OPERATIONS_MANAGER',
            'WAREHOUSE_STAFF',
          ],
          status: 'BANNED',
        }),
      ).toEqual(['roles.1', 'roles.2', 'roles.3', 'status']);
    });

    it('allows exactly the ACTIVE, INACTIVE, and LOCKED statuses', () => {
      expect(UserSchema.path('status').options).toMatchObject({
        enum: ['ACTIVE', 'INACTIVE', 'LOCKED'],
        default: UserStatus.ACTIVE,
      });
    });
  });
});
