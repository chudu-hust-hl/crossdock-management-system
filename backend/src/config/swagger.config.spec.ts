import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { HealthController } from '../health/health.controller';
import { LocationsController } from '../modules/locations/locations.controller';
import { LocationsService } from '../modules/locations/locations.service';
import { ShipmentEditsService } from '../modules/shipments/shipment-edits.service';
import { ShipmentsController } from '../modules/shipments/shipments.controller';
import { ShipmentsService } from '../modules/shipments/shipments.service';
import { createSwaggerDocument } from './swagger.config';

describe('Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const schema = (name: string): SchemaObject =>
    document.components!.schemas![name] as SchemaObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, LocationsController, ShipmentsController],
      providers: [
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
      '/health',
      '/locations',
      '/locations/{id}',
      '/shipments',
      '/shipments/book',
      '/shipments/{id}',
      '/shipments/{id}/appointments',
      '/shipments/{id}/items/{itemId}',
      '/shipments/{id}/view',
    ]);
    expect(Object.keys(document.paths['/locations'])).toEqual(['post', 'get']);
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
      expect(responses(path, 'put')).toEqual(['200', '400', '404', '409']);
    }
    expect(responses('/shipments/{id}/items/{itemId}', 'put')).toEqual([
      '200',
      '400',
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

  it('documents both POST /locations outcomes and the error responses', () => {
    const responses = document.paths['/locations'].post!.responses;
    expect(Object.keys(responses).sort()).toEqual(['200', '201', '400']);
    expect(
      Object.keys(document.paths['/locations/{id}'].get!.responses).sort(),
    ).toEqual(['200', '400', '404']);
    expect(
      Object.keys(document.paths['/shipments/book'].post!.responses).sort(),
    ).toEqual(['201', '400', '409', '503']);
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
