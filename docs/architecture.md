# Architecture

This document describes how the `cross-dock-management` backend is structured. Domain rules live in [`domain-model.md`](./domain-model.md).

## 1. Approach: modular monolith

The backend is a single NestJS application (one process, one deployment, one MongoDB database) divided into feature modules with clear boundaries.

Why:

- Simple to run, debug, and explain for a graduation project.
- Module boundaries keep the code organised and leave room to extract services later if a real need appears.
- No network calls, message brokers, or distributed transactions between modules.

Not in the initial design: microservices, message brokers (e.g. RabbitMQ), caches (e.g. Redis), cloud SDKs, hardware/RFID/IoT integrations, AI/ML.

## 2. Project structure

The repository is a monorepo:

```text
cross-dock-management/
├── backend/                    # NestJS application (npm commands run here)
├── frontend/                   # Angular application (created later)
├── docs/                       # project and domain documentation
├── .cursor/rules/              # Cursor project rules
└── docker-compose.yml          # local MongoDB
```

The backend uses NestJS 11 (the newest major whose CLI supports the project's Node.js 22.14), TypeScript 6 (strict by default), Mongoose 8, `@nestjs/config`, `ulid`, `class-validator` / `class-transformer` for request validation, and `@nestjs/swagger` for the API documentation.

```text
backend/src/
├── main.ts                     # bootstrap: create app, set up Swagger, read port, start HTTP server
├── app.module.ts               # root module: config, database, feature modules, global ValidationPipe
├── config/
│   ├── configuration.ts        # maps environment variables to typed config (incl. booking pricing)
│   ├── swagger.config.ts       # OpenAPI document; Swagger UI at /docs (+ spec)
│   └── validation.config.ts    # options of the global ValidationPipe
├── common/                     # code shared by several modules
│   ├── constants/
│   │   └── business-code-patterns.ts  # itemCode, code, routeNumber, taskNumber formats
│   ├── decorators/             # @Trim(), @IsUlid(), @IsNotBefore() for DTOs
│   ├── dto/
│   │   ├── error-response.dto.ts  # Nest's default error body, for Swagger only
│   │   ├── page-response.dto.ts   # `page`, `limit`, `total` of every list response
│   │   ├── pagination-query.dto.ts  # `?page=&limit=` of every list endpoint
│   │   ├── time-window.dto.ts  # appointment `{ from, to }` in requests and responses
│   │   └── ulid-param.dto.ts   # `:id` route parameter validated as a ULID
│   ├── enums/                  # DeliveryPointType, DeliveryPointStatus, BusinessCodeType, SortOrder
│   ├── interfaces/
│   ├── schemas/
│   │   └── time-window.schema.ts   # embedded { from, to }
│   └── utils/
│       ├── business-code.util.ts  # builds T-0001-1026-style codes
│       ├── mongo-error.util.ts # recognises duplicate-key errors (11000)
│       ├── pagination.util.ts  # findPage() and buildSort() for list endpoints
│       ├── sequence.util.ts    # unique `sequence` check for ordered arrays
│       ├── text-filter.util.ts # case-insensitive "contains" match for text filters
│       └── ulid.util.ts        # the single ULID generator
├── database/
│   └── database.module.ts      # one MongoDB connection for the whole app
├── health/
│   └── health.controller.ts    # GET /health (API process only)
└── modules/
    ├── locations/
    ├── users/
    ├── items/                  # Item schema, CreateItemDto, ItemsService (used by booking)
    ├── shipments/              # booking (POST /shipments/book), list and detail; ShipmentCostService
    ├── routes/
    ├── dock-tasks/
    └── metadata/               # `metadata` collection: business-code counters
```

Each feature module grows as needed:

```text
modules/<feature>/
├── enums/                      # enums owned by this feature
├── schemas/                    # Mongoose schemas (+ *.schema.spec.ts)
├── dto/                        # request/response DTOs
├── <feature>.controller.ts     # added when the feature exposes an API
├── <feature>.service.ts        # added when the feature has logic
└── <feature>.module.ts
```

Controllers, services, and DTOs are created when a feature needs them, not as empty placeholders. `common/` only holds code that is genuinely shared by more than one module.

## 3. Modules

One NestJS feature module per domain collection:

| Module | Collection |
| --- | --- |
| `LocationsModule` | `locations` |
| `UsersModule` | `users` |
| `ItemsModule` | `items` |
| `ShipmentsModule` | `shipments` |
| `RoutesModule` | `routes` |
| `DockTasksModule` | `dock_tasks` |
| `MetadataModule` | `metadata` (supporting collection: counters and changeable rules) |

Guidelines:

- A module registers its own Mongoose models with `MongooseModule.forFeature(...)`.
- Another module that needs this data imports the owning module and uses its **exported service**, rather than registering the same model again.
- There is exactly one MongoDB connection, configured once at application level.

## 4. Layer responsibilities

| Layer | Responsibility | Must not |
| --- | --- | --- |
| **Controller** | HTTP routing, reading params/body, calling a service, returning the result | Contain business rules or query the database directly |
| **Service** | Domain/business logic, validation of business rules, database access through Mongoose models, checking that referenced ULIDs exist | Depend on HTTP request objects |
| **DTO** | Shape and validation of data entering or leaving the API | Be used as the persistence model |
| **Schema** | Mongoose persistence model: fields, types, references, indexes, timestamps | Contain request-validation concerns |
| **Configuration** | Read environment variables (`@nestjs/config`) and expose typed values | Hardcode secrets or environment-specific values |

**Domain logic belongs in services, not controllers.**

### Schemas vs. DTOs

- A **schema** describes how a document is stored in MongoDB (including `_id`, ULID references, indexes, `createdAt`/`updatedAt`).
- A **DTO** describes what a client sends or receives. DTOs use ULID `id` values (validated with `@IsUlid()`), never `_id` ObjectIds, and never expose internal-only fields such as password hashes.
- The two are kept separate even when they look similar, because they change for different reasons.

### Request validation

- One global `ValidationPipe` is registered in `AppModule` (`APP_PIPE`), with the options in `config/validation.config.ts`:
  - `whitelist` and `forbidNonWhitelisted`: a property the DTO does not declare, such as `_id`, `status`, or `deliveryInfos`, fails the request with `400` instead of being silently dropped. Server-controlled fields are protected simply by not declaring them.
  - `transform`: controllers receive DTO class instances.
- Nested objects use `@IsObject()`, `@ValidateNested()`, and `@Type(() => NestedDto)`. Error messages carry the path, e.g. `pickup.location.address.postalCode should not be empty`.
- Required strings use `@Trim()` + `@IsNotEmpty()`, so whitespace-only values are rejected. Public IDs use `@IsUlid()` (both in `common/decorators/`).
- DTOs only check structure and basic input constraints. They never query MongoDB, resolve or create Locations, or apply business rules. That is the services' job.
- DTO tests (`dto/*.dto.spec.ts`) run bodies through the same pipe configuration with `test/utils/validate-body.ts`.

### Responses and errors

- Controllers return plain response objects built by a mapping function, e.g. `toLocationResponse()`. They never return Mongoose documents, so `_id`, `__v`, and `deletedAt` don't leak.
- Errors use Nest's built-in HTTP exceptions with the default body:
  - `400` for validation errors
  - `404` (`NotFoundException`) for an unknown or soft-deleted ULID (`GET /<resource>/:id`)
  - `409` (`ConflictException`) for a unique value that is already taken, e.g. an item barcode
  - `503` (`ServiceUnavailableException`) when required configuration is missing, e.g. booking pricing
- Services handle MongoDB duplicate-key errors (`11000`) where they are expected, with `isDuplicateKeyError()` (`common/utils/mongo-error.util.ts`). Examples are the store find-or-create in `LocationsService` and the booking in `ShipmentsService`.
- API integration tests (`test/<feature>-api.e2e-spec.ts`) boot only the feature module against their own test database and register the global pipe with `validationPipeOptions`.

### Lists: filtering, sorting and pagination

`GET /locations` and `GET /shipments` work the same way:

- **Query DTO:** `List<Feature>QueryDto` extends `PaginationQueryDto` (`common/dto/`) and adds the module's filters, plus `sortBy` and `sortOrder`. Like every DTO it is validated by the global pipe. An invalid value or an unknown parameter is a `400`, never silently ignored.
- **Paging:** `page` starts at 1 (default 1). `limit` is 1–100 (default 20).
- **Sorting:** `sortBy` is an enum of the module's sortable fields. `sortOrder` is `asc` or `desc`. `buildSort()` always adds the ULID `id` as a second sort key, so that records with equal values keep a stable order across pages.
- **Response:** `{ items, page, limit, total }`, where `total` counts the matches on all pages. An empty result, including a page past the last one, is `200` with `items: []`, not `404`.
- **Filter construction:** each service has public `buildListFilter(query)` and `buildListSort(query)` methods that turn the query DTO into the MongoDB filter and sort. They always add `deletedAt: null`. The service's `findAll()` passes them to `findPage()` (`common/utils/pagination.util.ts`), which runs the page query and the count. Controllers only map the result.
- **Text filters** match any part of the value, ignoring case (`containsIgnoringCase()`). The input is escaped, so `.*` matches literally. **Reference filters** (`parentId`, `itemId`, `locationId`) are validated with `@IsUlid()` and compared with the stored ULID strings; `_id` is never queried.

### API documentation (Swagger)

Every endpoint must appear in Swagger; this is a client requirement. `config/swagger.config.ts` builds the OpenAPI document, and `main.ts` serves it:

- `/docs`: Swagger UI
- `/docs-json`: the raw OpenAPI JSON

The documentation is written with explicit `@nestjs/swagger` decorators, so it is visible next to the code. The Nest CLI plugin that infers it automatically is not used.

- **Controllers:**
  - `@ApiTags('<feature>')` on the class.
  - On each handler, `@ApiOperation({ summary })` plus one response decorator per status it can return, e.g. `@ApiCreatedResponse`, `@ApiOkResponse`, `@ApiBadRequestResponse`, `@ApiNotFoundResponse`.
  - Error responses use `ErrorResponseDto` (`common/dto/`).
- **DTOs:** every property gets `@ApiProperty()`, or `@ApiPropertyOptional()` when it is optional. Enums use `{ enum, enumName }`. Nested objects use `{ type: NestedDto }`.
- **Response bodies** are classes, not interfaces, because Swagger can only describe classes. Example: `LocationResponse`.
- `config/swagger.config.spec.ts` generates the document without a database. It checks that every endpoint, response status, parameter, and required field is documented. When a controller is added, add it to this test.

Implemented DTOs: `CreateLocationDto`, `AddressDto`, `LocationCandidateDto`, `ListLocationsQueryDto`, and the `LocationResponse` / `LocationPageResponse` mappings (`locations/dto/`); `CreateShipmentDto`, `ShipmentEndpointDto`, `ListShipmentsQueryDto`, and `ShipmentResponse` / `ShipmentPageResponse` (`shipments/dto/`); `CreateItemDto` and `DimensionsDto` (`items/dto/`); `UlidParamDto`, `PaginationQueryDto`, `PageResponse`, and `TimeWindowDto` / `TimeWindowResponse` (`common/dto/`). See [`business-workflows.md`](./business-workflows.md) for the workflows they serve.

## 5. Identifier strategy

- `id` (ULID string, unique index): the identifier used everywhere: references between documents, lookups (`findOne({ id })`), and the API.
- `_id` (ObjectId): MongoDB's default primary key. It is kept but not used by the application, and never stored in references.
- The ULID is generated by `generateUlid()` in `backend/src/common/utils/ulid.util.ts`, used as `@Prop({ default: generateUlid })`.
- `ulidValidator` in the same file is the Mongoose `validate` option for `id` and every reference field. `isValidUlid()` accepts only the canonical upper-case form. DTOs use `@IsUlid()`, which calls it.
- Because stored references and API values are the same ULIDs, services need no ID conversion. `populate` is not used, because it only follows `_id`. Related documents are loaded with explicit `findOne({ id })` / `find({ id: { $in: ids } })` queries.

See [`domain-model.md` §2](./domain-model.md#2-identifiers).

## 6. Configuration and local infrastructure

- Configuration uses `@nestjs/config` with environment variables. At minimum: `NODE_ENV`, `PORT`, `MONGODB_URI`.
- `backend/.env.example` documents the variables; `backend/.env` is local only and ignored by Git. `MONGODB_URI` is required; the app fails at startup with a clear message if it is missing.
- Local MongoDB runs with the root `docker-compose.yml` (`mongo:8.0`), exposed on `127.0.0.1:27018` (to avoid clashing with a local MongoDB on `27017`), with the named volume `cross-dock-management-mongodb-data`.
- Default local URI: `mongodb://localhost:27018/cross_dock_management`.
- A `GET /health` endpoint reports that the API process is running. It does not claim that MongoDB is healthy; a database health check may be added later.

## 7. Design before APIs

Schemas and relationships are designed deliberately, one entity at a time, before business APIs are built on top of them. Each schema is reviewed against `domain-model.md`, and open questions are resolved with the project owner rather than guessed.

## 8. Implementation roadmap

1. Initialize NestJS and database configuration. *(done)*
2. Implement the Location schema. *(done)*
3. Implement the User schema. *(done)*
4. Implement the Item schema. *(done)*
5. Implement the Shipment schema. *(done)*
6. Implement the Route schema. *(done)*
7. Implement the DockTask schema. *(done)*
8. Add DTO validation, services, APIs, and tests incrementally. *(in progress: validation setup, the Location service and API, and shipment booking with items and cost (`POST /shipments/book`), and list/detail endpoints for Locations and Shipments are done)*
9. Add authentication and additional infrastructure only when needed.

Each step should build, lint, and (where tests exist) pass tests before moving to the next.

Schema steps add two kinds of tests:

- `src/**/<name>.schema.spec.ts` (`npm test`): schema definition and in-memory validation, no database.
- `test/*.e2e-spec.ts` (`npm run test:e2e`): integration against MongoDB (indexes, duplicate keys, timestamps). Each file uses its own `cross_dock_management_test_<name>` database through `test/utils/test-database.ts`. Jest runs files in parallel and each file drops its database when it finishes, so two files must never share a database.
