import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateUlid, isValidUlid } from '../src/common/utils/ulid.util';
import { validationPipeOptions } from '../src/config/validation.config';
import { AuthModule } from '../src/modules/auth/auth.module';
import { LoginResponse } from '../src/modules/auth/dto/login-response.dto';
import {
  UserPageResponse,
  UserResponse,
} from '../src/modules/users/dto/user-response.dto';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { User } from '../src/modules/users/schemas/user.schema';
import { UsersService } from '../src/modules/users/users.service';
import { bearer, tokenFor } from './utils/test-auth';
import { testDatabaseImports } from './utils/test-database';

// Integration test: requires MongoDB at MONGODB_URI. Uses its own database,
// which is emptied before each test and dropped afterwards.
const TEST_DB_NAME = 'cross_dock_management_test_users_api';

const PASSWORD = 'correct horse battery';

describe('Users API (integration)', () => {
  let app: INestApplication<App>;
  let moduleRef: TestingModule;
  let userModel: Model<User>;
  let usersService: UsersService;
  /** The logged-in SYS_ADMIN who calls the endpoints. */
  let me: UserResponse;
  let myToken: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [...testDatabaseImports(TEST_DB_NAME), AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // AppModule registers this pipe globally; this test module does not import AppModule.
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    userModel = moduleRef.get(getModelToken(User.name));
    usersService = moduleRef.get(UsersService);
    await userModel.init();
  });

  beforeEach(async () => {
    await userModel.deleteMany({});
    await usersService.create({
      fullName: 'Root Admin',
      email: 'root@example.com',
      password: PASSWORD,
      roles: [UserRole.SYS_ADMIN],
    });
    const body = (await login('root@example.com', PASSWORD).expect(200))
      .body as LoginResponse;
    me = body.user;
    myToken = body.accessToken;
  });

  afterAll(async () => {
    await userModel.db.dropDatabase();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  function login(email: string, password: string) {
    return http().post('/auth/login').send({ email, password });
  }

  function createUser(body: object, token = myToken) {
    return http().post('/users').set('Authorization', bearer(token)).send(body);
  }

  function updateUser(id: string, body: object, token = myToken) {
    return http()
      .put(`/users/${id}`)
      .set('Authorization', bearer(token))
      .send(body);
  }

  function newUser(overrides: Record<string, unknown> = {}) {
    return {
      fullName: 'Tran Thi B',
      email: 'B.Tran@Example.com',
      password: PASSWORD,
      roles: [UserRole.ADMIN],
      ...overrides,
    };
  }

  describe('POST /users', () => {
    it('creates an ACTIVE user with a hashed password, without internal fields', async () => {
      const response = await createUser(newUser()).expect(201);
      const body = response.body as UserResponse;

      expect(isValidUlid(body.id)).toBe(true);
      expect(body).toMatchObject({
        fullName: 'Tran Thi B',
        email: 'b.tran@example.com',
        roles: ['ADMIN'],
        status: 'ACTIVE',
      });
      for (const field of ['passwordHash', 'password', '_id', '__v']) {
        expect(body).not.toHaveProperty(field);
      }
      expect(body).not.toHaveProperty('deletedAt');

      const stored = await userModel
        .findOne({ id: body.id })
        .select('+passwordHash')
        .lean<User>();
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(stored?.passwordHash).not.toContain(PASSWORD);
      await login('b.tran@example.com', PASSWORD).expect(200);
    });

    it('answers 409 when the email exists, in any case', async () => {
      await createUser(newUser()).expect(201);

      const response = await createUser(
        newUser({ email: 'b.tran@EXAMPLE.com' }),
      ).expect(409);

      expect((response.body as { message: string }).message).toBe(
        'Email b.tran@example.com is already registered',
      );
    });

    it.each([
      ['a short password', { password: 'short' }],
      ['no roles', { roles: [] }],
      ['a role twice', { roles: ['ADMIN', 'ADMIN'] }],
      ['a retired role', { roles: ['WAREHOUSE_STAFF'] }],
      ['an invalid email', { email: 'not-an-email' }],
      ['a status', { status: 'LOCKED' }],
    ])('rejects %s with 400', async (_case, overrides) => {
      await createUser(newUser(overrides)).expect(400);
      expect(await userModel.countDocuments()).toBe(1);
    });
  });

  describe('GET /users', () => {
    it('lists non-deleted users by fullName, filtered by email and status', async () => {
      for (const [fullName, email] of [
        ['Zed', 'zed@shop.vn'],
        ['Anh', 'anh@shop.vn'],
        ['Deleted', 'deleted@shop.vn'],
      ]) {
        await createUser(newUser({ fullName, email })).expect(201);
      }
      await userModel.updateOne(
        { email: 'deleted@shop.vn' },
        { $set: { deletedAt: new Date() } },
      );
      await userModel.updateOne(
        { email: 'zed@shop.vn' },
        { $set: { status: 'LOCKED' } },
      );

      const all = (
        await http()
          .get('/users')
          .set('Authorization', bearer(myToken))
          .expect(200)
      ).body as UserPageResponse;
      expect(all).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(all.items.map((user) => user.fullName)).toEqual([
        'Anh',
        'Root Admin',
        'Zed',
      ]);

      const filtered = (
        await http()
          .get('/users?email=SHOP.VN&status=LOCKED')
          .set('Authorization', bearer(myToken))
          .expect(200)
      ).body as UserPageResponse;
      expect(filtered.items.map((user) => user.email)).toEqual(['zed@shop.vn']);
    });
  });

  describe('GET /users/:id', () => {
    it('returns a user, 404 when unknown or deleted, and 400 for a non-ULID', async () => {
      const created = (await createUser(newUser()).expect(201))
        .body as UserResponse;
      const get = (id: string) =>
        http().get(`/users/${id}`).set('Authorization', bearer(myToken));

      expect((await get(created.id).expect(200)).body).toEqual(created);
      await get(generateUlid()).expect(404);
      await get('not-a-ulid').expect(400);

      await userModel.updateOne(
        { id: created.id },
        { $set: { deletedAt: new Date() } },
      );
      await get(created.id).expect(404);
    });
  });

  describe('PUT /users/:id', () => {
    it('changes only the fields sent; a new password is hashed', async () => {
      const created = (await createUser(newUser()).expect(201))
        .body as UserResponse;

      const response = await updateUser(created.id, {
        email: 'New.Email@Example.com',
        roles: [UserRole.DOCK_MANAGER, UserRole.DOCK_OPERATOR],
        password: 'another password',
      }).expect(200);

      expect(response.body).toMatchObject({
        id: created.id,
        fullName: 'Tran Thi B',
        email: 'new.email@example.com',
        roles: ['DOCK_MANAGER', 'DOCK_OPERATOR'],
        status: 'ACTIVE',
      });
      expect(response.body).not.toHaveProperty('passwordHash');
      await login('new.email@example.com', PASSWORD).expect(401);
      await login('new.email@example.com', 'another password').expect(200);
    });

    it('locks another user, who then cannot log in', async () => {
      const created = (await createUser(newUser()).expect(201))
        .body as UserResponse;

      await updateUser(created.id, { status: 'LOCKED' }).expect(200);

      await login('b.tran@example.com', PASSWORD).expect(401);
    });

    it('rejects empty roles, a blank name and a duplicate email', async () => {
      const created = (await createUser(newUser()).expect(201))
        .body as UserResponse;

      await updateUser(created.id, { roles: [] }).expect(400);
      await updateUser(created.id, { fullName: ' ' }).expect(400);
      await updateUser(created.id, { email: 'ROOT@example.com' }).expect(409);
      await updateUser(generateUlid(), { fullName: 'X' }).expect(404);
    });

    it.each([
      [{ status: 'LOCKED' }, 'You cannot set your own status to LOCKED.'],
      [{ status: 'INACTIVE' }, 'You cannot set your own status to INACTIVE.'],
      [
        { roles: [UserRole.ADMIN] },
        'You cannot remove SYS_ADMIN from your own roles.',
      ],
    ])(
      'stops a SYS_ADMIN from locking themselves out: %j',
      async (change, message) => {
        const response = await updateUser(me.id, change).expect(400);

        expect((response.body as { message: string }).message).toBe(message);
        const stored = await userModel.findOne({ id: me.id }).lean<User>();
        expect(stored).toMatchObject({
          status: 'ACTIVE',
          roles: ['SYS_ADMIN'],
        });
      },
    );

    it('lets a SYS_ADMIN keep SYS_ADMIN while adding a role', async () => {
      const response = await updateUser(me.id, {
        roles: [UserRole.SYS_ADMIN, UserRole.ADMIN],
        status: 'ACTIVE',
      }).expect(200);

      expect((response.body as UserResponse).roles).toEqual([
        'SYS_ADMIN',
        'ADMIN',
      ]);
    });
  });

  it('allows only SYS_ADMIN: 401 without a token, 403 for any other role', async () => {
    await http().get('/users').expect(401);
    await createUser(newUser(), 'not-a-jwt').expect(401);

    for (const role of [
      UserRole.ADMIN,
      UserRole.DOCK_MANAGER,
      UserRole.DOCK_OPERATOR,
    ]) {
      const token = await tokenFor(moduleRef, role);
      await http()
        .get('/users')
        .set('Authorization', bearer(token))
        .expect(403);
      await createUser(newUser(), token).expect(403);
      await updateUser(me.id, { fullName: 'X' }, token).expect(403);
    }
  });
});
