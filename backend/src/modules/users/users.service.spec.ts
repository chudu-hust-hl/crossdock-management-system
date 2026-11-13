import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import { Model } from 'mongoose';
import { generateUlid } from '../../common/utils/ulid.util';
import { AppConfig, AuthSeedConfig } from '../../config/configuration';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

const SEED: AuthSeedConfig = {
  email: 'Root@Example.com',
  password: 'seed password',
  fullName: 'Root Admin',
};

function setup(options: {
  sysAdminExists: boolean;
  seed: AuthSeedConfig | null;
}) {
  const userModel = {
    exists: jest.fn().mockReturnValue({
      exec: () => Promise.resolve(options.sysAdminExists ? { _id: 'x' } : null),
    }),
    create: jest.fn((fields: Partial<User>) =>
      Promise.resolve({ toObject: () => ({ id: generateUlid(), ...fields }) }),
    ),
    findOneAndUpdate: jest.fn(),
  };
  const configService = { get: jest.fn().mockReturnValue(options.seed) };
  const service = new UsersService(
    userModel as unknown as Model<User>,
    configService as unknown as ConfigService<AppConfig, true>,
  );
  return { service, userModel };
}

describe('UsersService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('first SYS_ADMIN on startup', () => {
    it('does nothing when a non-deleted SYS_ADMIN exists', async () => {
      const { service, userModel } = setup({
        sysAdminExists: true,
        seed: SEED,
      });

      await service.onApplicationBootstrap();

      expect(userModel.exists).toHaveBeenCalledWith({
        roles: UserRole.SYS_ADMIN,
        deletedAt: null,
      });
      expect(userModel.create).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('creates the seed user as an ACTIVE SYS_ADMIN with a hashed password', async () => {
      const { service, userModel } = setup({
        sysAdminExists: false,
        seed: SEED,
      });

      await service.onApplicationBootstrap();

      expect(userModel.create).toHaveBeenCalledTimes(1);
      const [fields] = userModel.create.mock.calls[0] as [User];
      expect(fields).toMatchObject({
        fullName: 'Root Admin',
        email: 'root@example.com',
        roles: [UserRole.SYS_ADMIN],
        status: UserStatus.ACTIVE,
      });
      expect(await compare(SEED.password, fields.passwordHash!)).toBe(true);
    });

    it('starts anyway and warns when there is no SYS_ADMIN and no seed', async () => {
      const { service, userModel } = setup({
        sysAdminExists: false,
        seed: null,
      });

      await service.onApplicationBootstrap();

      expect(userModel.create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'AUTH_SEED_EMAIL, AUTH_SEED_PASSWORD, AUTH_SEED_NAME',
        ),
      );
    });
  });

  describe('update of your own user', () => {
    const caller = { id: generateUlid(), roles: [UserRole.SYS_ADMIN] };

    it.each([
      [
        { status: UserStatus.LOCKED },
        'You cannot set your own status to LOCKED.',
      ],
      [
        { status: UserStatus.INACTIVE },
        'You cannot set your own status to INACTIVE.',
      ],
      [
        { roles: [UserRole.ADMIN, UserRole.DOCK_MANAGER] },
        'You cannot remove SYS_ADMIN from your own roles.',
      ],
    ])('rejects %j with 400 before writing', async (dto, message) => {
      const { service, userModel } = setup({
        sysAdminExists: true,
        seed: null,
      });

      await expect(service.update(caller.id, dto, caller)).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('allows the same changes on another user', async () => {
      const { service, userModel } = setup({
        sysAdminExists: true,
        seed: null,
      });
      const other = generateUlid();
      userModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ id: other }) }),
      });

      await service.update(
        other,
        { status: UserStatus.LOCKED, roles: [UserRole.ADMIN] },
        caller,
      );

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { id: other, deletedAt: null },
        { $set: { status: UserStatus.LOCKED, roles: [UserRole.ADMIN] } },
        { new: true, runValidators: true },
      );
    });
  });
});
