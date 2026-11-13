import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { LoginResponse } from '../src/modules/auth/dto/login-response.dto';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { UserStatus } from '../src/modules/users/enums/user-status.enum';
import { User } from '../src/modules/users/schemas/user.schema';
import { UsersService } from '../src/modules/users/users.service';
import { bearer } from './utils/test-auth';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_auth_api';

const PASSWORD = 'correct horse battery';
const INVALID = 'Invalid email or password.';

describe('Auth API (integration)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let usersService: UsersService;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    userModel = moduleRef.get(getModelToken(User.name));
    usersService = moduleRef.get(UsersService);
    jwtService = moduleRef.get(JwtService);
    await userModel.init();
  });

  beforeEach(async () => {
    await userModel.deleteMany({});
  });

  afterAll(async () => {
    await userModel.db.dropDatabase();
    await app.close();
  });

  function createUser(email: string, roles = [UserRole.SYS_ADMIN]) {
    return usersService.create({
      fullName: 'Nguyen Van A',
      email,
      password: PASSWORD,
      roles,
    });
  }

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
  }

  it('logs in with the email in any case and returns a token for 8 hours', async () => {
    const user = await createUser('admin@example.com', [
      UserRole.SYS_ADMIN,
      UserRole.ADMIN,
    ]);

    const response = await login(' Admin@Example.COM ', PASSWORD).expect(200);
    const body = response.body as LoginResponse;

    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 28800,
      user: {
        id: user.id,
        email: 'admin@example.com',
        roles: ['SYS_ADMIN', 'ADMIN'],
        status: 'ACTIVE',
      },
    });
    expect(Object.keys(body.user).sort()).toEqual([
      'createdAt',
      'email',
      'fullName',
      'id',
      'lastLoginAt',
      'roles',
      'status',
      'updatedAt',
    ]);

    const payload = jwtService.verify<{
      sub: string;
      roles: string[];
      iat: number;
      exp: number;
    }>(body.accessToken);
    expect(payload).toMatchObject({
      sub: user.id,
      roles: ['SYS_ADMIN', 'ADMIN'],
    });
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);

    const stored = await userModel.findOne({ id: user.id }).lean<User>();
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
    expect(new Date(body.user.lastLoginAt!)).toEqual(stored?.lastLoginAt);
  });

  it('answers a wrong password and an unknown email with the same 401', async () => {
    await createUser('admin@example.com');

    for (const [email, password] of [
      ['admin@example.com', 'wrong password'],
      ['nobody@example.com', PASSWORD],
    ]) {
      const response = await login(email, password).expect(401);
      expect((response.body as { message: string }).message).toBe(INVALID);
    }
    const stored = await userModel
      .findOne({ email: 'admin@example.com' })
      .lean<User>();
    expect(stored?.lastLoginAt).toBeUndefined();
  });

  it.each([
    ['LOCKED', { status: UserStatus.LOCKED }],
    ['INACTIVE', { status: UserStatus.INACTIVE }],
    ['soft-deleted', { deletedAt: new Date() }],
  ])(
    'refuses a %s user with the correct password, with the same 401',
    async (_case, change) => {
      const user = await createUser('staff@example.com');
      await userModel.updateOne({ id: user.id }, { $set: change });

      const response = await login('staff@example.com', PASSWORD).expect(401);

      expect((response.body as { message: string }).message).toBe(INVALID);
    },
  );

  it('rejects a token once its user is locked or deleted after login', async () => {
    const locked = await createUser('locked@example.com');
    const deleted = await createUser('deleted@example.com');
    const tokens = await Promise.all(
      ['locked@example.com', 'deleted@example.com'].map(
        async (email) =>
          ((await login(email, PASSWORD).expect(200)).body as LoginResponse)
            .accessToken,
      ),
    );
    for (const token of tokens) {
      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', bearer(token))
        .expect(200);
    }

    await userModel.updateOne(
      { id: locked.id },
      { $set: { status: UserStatus.LOCKED } },
    );
    await userModel.updateOne(
      { id: deleted.id },
      { $set: { deletedAt: new Date() } },
    );

    for (const token of tokens) {
      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', bearer(token))
        .expect(401);
    }
  });

  it('rejects a token signed with another secret', async () => {
    const user = await createUser('admin@example.com');
    const forged = new JwtService({ secret: 'another-secret' }).sign({
      sub: user.id,
      roles: [UserRole.SYS_ADMIN],
    });

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', bearer(forged))
      .expect(401);
  });

  it('requires both fields and has no registration endpoint', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@example.com' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'x@example.com', password: PASSWORD })
      .expect(404);
  });
});
