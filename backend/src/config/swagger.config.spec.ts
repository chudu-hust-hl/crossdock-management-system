import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { HealthController } from '../health/health.controller';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { LocationsController } from '../modules/locations/locations.controller';
import { LocationsService } from '../modules/locations/locations.service';
import { ShipmentEditsService } from '../modules/shipments/shipment-edits.service';
import { ShipmentsController } from '../modules/shipments/shipments.controller';
import { ShipmentsService } from '../modules/shipments/shipments.service';
import { UsersController } from '../modules/users/users.controller';
import { UsersService } from '../modules/users/users.service';
import { createSwaggerDocument } from './swagger.config';

describe('Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const schema = (name: string): SchemaObject =>
    document.components!.schemas![name] as SchemaObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        HealthController,
        AuthController,
        LocationsController,
        ShipmentsController,
        UsersController,
      ],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: LocationsService, useValue: {} },
        { provide: ShipmentsService, useValue: {} },
        { provide: ShipmentEditsService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every endpoint', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      '/auth/login',
      '/health',
      '/locations',
      '/locations/{id}',
      '/shipments',
      '/shipments/book',
      '/shipments/{id}',
      '/shipments/{id}/appointments',
      '/shipments/{id}/items/{itemId}',
      '/shipments/{id}/view',
      '/users',
      '/users/{id}',
    ]);
    expect(Object.keys(document.paths['/locations'])).toEqual(['post', 'get']);
    expect(Object.keys(document.paths['/users'])).toEqual(['post', 'get']);
    expect(Object.keys(document.paths['/users/{id}'])).toEqual(['get', 'put']);
    expect(Object.keys(document.paths['/shipments'])).toEqual(['get']);
    expect(Object.keys(document.paths['/shipments/{id}'])).toEqual([
      'get',
      'put',
    ]);
    expect(Object.keys(document.paths['/shipments/{id}/view'])).toEqual([
      'get',
    ]);
    for (const path of [
      '/shipments/{id}/appointments',
      '/shipments/{id}/items/{itemId}',
    ]) {
      expect(Object.keys(document.paths[path])).toEqual(['put']);
    }
  });

  it('documents the booking view and the three PUT endpoints', () => {
    const responses = (path: string, method: 'get' | 'put') =>
      Object.keys(document.paths[path][method]!.responses).sort();

    expect(responses('/shipments/{id}/view', 'get')).toEqual([
      '200',
      '400',
      '404',
    ]);
    for (const path of ['/shipments/{id}', '/shipments/{id}/appointments']) {
      expect(responses(path, 'put')).toEqual([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
      ]);
    }
    expect(responses('/shipments/{id}/items/{itemId}', 'put')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '503',
    ]);
    expect(
      document.paths['/shipments/{id}/items/{itemId}'].put!.parameters,
    ).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'itemId', in: 'path', required: true }),
    ]);
    expect(schema('UpdateShipmentCustomerDto').required).toEqual([
      'customerName',
    ]);
    expect(schema('UpdateAppointmentsDto').required).toEqual([
      'pickup',
      'dropoff',
    ]);
    expect(schema('UpdateItemDto').required).toBeUndefined();
    expect(Object.keys(schema('UpdateItemDto').properties!)).toEqual([
      'description',
      'itemUnit',
      'weight',
      'weightUnit',
      'dimensions',
    ]);
    expect(schema('ShipmentViewResponse').required).toEqual([
      'shipment',
      'locations',
      'items',
      'children',
      'routes',
    ]);
    expect(Object.keys(schema('RouteItemResponse').properties!)).toEqual([
      'itemId',
      'shipmentId',
      'itemCode',
      'barcode',
    ]);
  });

  it('describes a list row as a summary, not as the full Shipment', () => {
    expect(schema('ShipmentPageResponse').properties!.items).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ShipmentSummaryResponse' },
    });
    expect(schema('ShipmentSummaryResponse').required).toEqual([
      'id',
      'code',
      'status',
      'createdAt',
      'origin',
      'destination',
      'pickupAppointment',
      'dropoffAppointment',
      'items',
      'routed',
    ]);
    expect(schema('ShipmentEndResponse').required).toEqual([
      'id',
      'name',
      'type',
      'province',
    ]);
  });

  const operations = () =>
    Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'post', 'put'] as const)
        .filter((method) => item[method])
        .map((method) => ({
          route: `${method.toUpperCase()} ${path}`,
          operation: item[method]!,
        })),
    );

  it('declares the bearer scheme and marks exactly the protected writes with it', () => {
    expect(document.components!.securitySchemes).toEqual({
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });

    const secured = operations()
      .filter(({ operation }) => operation.security?.length)
      .map(({ route }) => route)
      .sort();
    expect(secured).toEqual([
      'GET /users',
      'GET /users/{id}',
      'POST /locations',
      'POST /shipments/book',
      'POST /users',
      'PUT /shipments/{id}',
      'PUT /shipments/{id}/appointments',
      'PUT /shipments/{id}/items/{itemId}',
      'PUT /users/{id}',
    ]);
    // POST /auth/login also answers 401 (wrong credentials), but never 403.
    for (const { route, operation } of operations()) {
      const statuses = Object.keys(operation.responses);
      if (secured.includes(route)) {
        expect([route, operation.security]).toEqual([route, [{ bearer: [] }]]);
        expect([route, statuses]).toEqual([
          route,
          expect.arrayContaining(['401', '403']),
        ]);
      } else {
        expect([route, statuses.includes('403')]).toEqual([route, false]);
      }
    }
  });

  it('documents login and the user endpoints', () => {
    const responses = (path: string, method: 'get' | 'post' | 'put') =>
      Object.keys(document.paths[path][method]!.responses).sort();

    expect(responses('/auth/login', 'post')).toEqual(['200', '400', '401']);
    expect(responses('/users', 'post')).toEqual([
      '201',
      '400',
      '401',
      '403',
      '409',
    ]);
    expect(responses('/users', 'get')).toEqual(['200', '400', '401', '403']);
    expect(responses('/users/{id}', 'get')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(responses('/users/{id}', 'put')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(document.paths['/users/{id}'].put!.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);

    expect(schema('LoginDto').required).toEqual(['email', 'password']);
    expect(schema('LoginResponse').required).toEqual([
      'accessToken',
      'tokenType',
      'expiresIn',
      'user',
    ]);
    expect(schema('CreateUserDto').required).toEqual([
      'fullName',
      'email',
      'password',
      'roles',
    ]);
    expect(schema('UpdateUserDto').required).toBeUndefined();
    expect(Object.keys(schema('UserResponse').properties!)).toEqual([
      'id',
      'fullName',
      'email',
      'roles',
      'status',
      'lastLoginAt',
      'createdAt',
      'updatedAt',
    ]);
    expect(schema('UserRole').enum).toEqual([
      'SYS_ADMIN',
      'ADMIN',
      'DOCK_MANAGER',
      'DOCK_OPERATOR',
    ]);
    expect(schema('UserPageResponse').required).toEqual([
      'page',
      'limit',
      'total',
      'items',
    ]);
    const query = document.paths['/users'].get!.parameters as {
      name: string;
    }[];
    expect(query.map((parameter) => parameter.name)).toEqual([
      'page',
      'limit',
      'email',
      'status',
      'sortBy',
      'sortOrder',
    ]);
    expect(schema('UserSortField').enum).toEqual([
      'fullName',
      'email',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('documents both POST /locations outcomes and the error responses', () => {
    const responses = document.paths['/locations'].post!.responses;
    expect(Object.keys(responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '401',
      '403',
    ]);
    expect(
      Object.keys(document.paths['/locations/{id}'].get!.responses).sort(),
    ).toEqual(['200', '400', '404']);
    expect(
      Object.keys(document.paths['/shipments/book'].post!.responses).sort(),
    ).toEqual(['201', '400', '401', '403', '409', '503']);
  });

  it('documents the list and detail responses of both modules', () => {
    for (const path of ['/locations', '/shipments']) {
      expect(Object.keys(document.paths[path].get!.responses).sort()).toEqual([
        '200',
        '400',
      ]);
    }
    expect(
      Object.keys(document.paths['/shipments/{id}'].get!.responses).sort(),
    ).toEqual(['200', '400', '404']);
    for (const name of ['LocationPageResponse', 'ShipmentPageResponse']) {
      expect(schema(name).required).toEqual([
        'page',
        'limit',
        'total',
        'items',
      ]);
    }
  });

  it('documents the path parameters', () => {
    for (const path of ['/locations/{id}', '/shipments/{id}']) {
      expect(document.paths[path].get!.parameters).toEqual([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
      ]);
    }
  });

  const optionalQuery = (path: string) => {
    const parameters = document.paths[path].get!.parameters as {
      name: string;
      in: string;
      required: boolean;
    }[];
    expect(parameters.every((p) => p.in === 'query' && !p.required)).toBe(true);
    return parameters.map((p) => p.name);
  };

  it('documents the same paging and sorting parameters on both lists', () => {
    for (const path of ['/locations', '/shipments']) {
      expect(optionalQuery(path)).toEqual(
        expect.arrayContaining(['page', 'limit', 'sortBy', 'sortOrder']),
      );
    }
    expect(schema('SortOrder').enum).toEqual(['asc', 'desc']);
  });

  it('documents the filters of each list', () => {
    expect(optionalQuery('/locations')).toEqual([
      'page',
      'limit',
      'type',
      'status',
      'name',
      'contactName',
      'postalCode',
      'sortBy',
      'sortOrder',
    ]);
    expect(optionalQuery('/shipments')).toEqual([
      'page',
      'limit',
      'status',
      'code',
      'customerName',
      'isRoot',
      'parentId',
      'itemId',
      'locationId',
      'sortBy',
      'sortOrder',
    ]);
    expect(schema('LocationSortField').enum).toEqual([
      'name',
      'createdAt',
      'updatedAt',
    ]);
    expect(schema('ShipmentSortField').enum).toEqual([
      'createdAt',
      'updatedAt',
      'code',
      'customerName',
      'cost',
    ]);
  });

  it('describes the create body with its required fields', () => {
    expect(schema('CreateLocationDto').required).toEqual([
      'name',
      'type',
      'address',
    ]);
    expect(schema('AddressDto').required).toEqual([
      'addressLine1',
      'postalCode',
    ]);
    expect(schema('LocationType').enum).toEqual([
      'WAREHOUSE',
      'CROSS_DOCK',
      'STORE',
      'CUSTOMER',
    ]);
  });

  it('describes the shipment body, including both appointments', () => {
    expect(schema('CreateShipmentDto').required).toEqual([
      'customerName',
      'pickup',
      'dropoff',
      'items',
    ]);
    expect(schema('CreateItemDto').required).toEqual([
      'barcode',
      'itemUnit',
      'weight',
      'weightUnit',
    ]);
    expect(schema('ItemUnit').enum).toEqual(['BOX', 'PALLET', 'KEG', 'BAG']);
    expect(schema('CreateShipmentDto').properties).not.toHaveProperty(
      'itemIds',
    );
    expect(schema('ShipmentEndpointDto').required).toEqual([
      'location',
      'appointment',
    ]);
    expect(schema('LocationCandidateDto').required).toEqual([
      'name',
      'contactName',
      'address',
    ]);
    expect(schema('TimeWindowDto').required).toEqual(['from', 'to']);
  });

  it('exposes only public fields in the Shipment response', () => {
    const properties = Object.keys(schema('ShipmentResponse').properties!);
    expect(properties).toEqual(
      expect.arrayContaining([
        'id',
        'code',
        'customerName',
        'cost',
        'itemIds',
        'deliveryInfos',
      ]),
    );
    expect(properties).not.toContain('_id');
    expect(properties).not.toContain('deletedAt');
  });

  it('exposes only public fields in the Location response', () => {
    const properties = Object.keys(schema('LocationResponse').properties!);
    expect(properties).toContain('id');
    expect(properties).not.toContain('_id');
    expect(properties).not.toContain('deletedAt');
  });
});
