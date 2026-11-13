# Architecture

This document describes how the `cross-dock-management` backend and frontend are structured. Domain rules live in [`domain-model.md`](./domain-model.md).

## 1. Approach: modular monolith

The backend is a single NestJS application (one process, one deployment, one MongoDB database) divided into feature modules with clear boundaries.

Why:

- Simple to run, debug, and explain for a graduation project.
- Module boundaries keep the code organised and leave room to extract services later if a real need appears.
- Modules call each other in-process. They do not use the network or a distributed transaction. The scanning broker below is the one exception.

Not in the initial design: microservices, caches (e.g. Redis), cloud SDKs, hardware/RFID/IoT integrations, AI/ML.

Scanning is the one approved use of a message broker. Queue names, events, and the status rules are in [`scanning-flows.md`](./scanning-flows.md). That flow is agreed and not implemented. Booking, routing, and the read APIs do not publish or consume messages.

## 2. Project structure

The repository is a monorepo:

```text
cross-dock-management/
├── backend/                    # NestJS application (npm commands run here)
├── frontend/                   # Angular application (npm commands run here), see §9
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
    ├── auth/                   # POST /auth/login, the JWT config, AuthGuard, @Roles(), @CurrentUser()
    ├── locations/
    ├── users/                  # user management by SYS_ADMIN (/users), startup seed of the first SYS_ADMIN
    ├── items/                  # Item schema, CreateItemDto, UpdateItemDto, ItemsService (used by booking)
    ├── shipments/              # booking (POST /shipments/book), list, detail, view; ShipmentCostService;
    │                           #   ShipmentEditsService (the three booking-correction PUTs)
    ├── routing/                # hub selection after booking; reads provinces, updates deliveryInfos
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

One NestJS feature module per domain collection. `RoutingModule` is the booking routing rule, and `AuthModule` is login; neither owns a domain collection.

| Module | Collection |
| --- | --- |
| `LocationsModule` | `locations` |
| `UsersModule` | `users` |
| `ItemsModule` | `items` |
| `ShipmentsModule` | `shipments` |
| `RoutesModule` | `routes` |
| `DockTasksModule` | `dock_tasks` |
| `MetadataModule` | `metadata` (supporting collection: counters and changeable rules) |
| `RoutingModule` | no domain collection of its own. Reads the existing `provinces` reference data and updates a booked shipment's `deliveryInfos` |
| `AuthModule` | no domain collection of its own. `POST /auth/login`; registers `JwtModule` once, as global, so `AuthGuard` can verify tokens anywhere |

Guidelines:

- A module registers its own Mongoose models with `MongooseModule.forFeature(...)`.
- Another module that needs this data imports the owning module and uses its **exported service**, rather than registering the same model again. `RoutingModule` also registers the `Shipment` model so it can save `deliveryInfos` without importing `ShipmentsModule` (that import would be a cycle). Both use the same schema on the one application connection. Cross-docks are loaded through the exported `LocationsService`.
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
  - `401` (`UnauthorizedException`) for a failed login, or a protected endpoint called without a valid token
  - `403` (`ForbiddenException`) for a valid token without an allowed role
  - `404` (`NotFoundException`) for an unknown or soft-deleted ULID (`GET /<resource>/:id`)
  - `409` (`ConflictException`) for a unique value that is already taken, e.g. an item barcode
  - `503` (`ServiceUnavailableException`) when required configuration is missing, e.g. booking pricing
- Services handle MongoDB duplicate-key errors (`11000`) where they are expected, with `isDuplicateKeyError()` (`common/utils/mongo-error.util.ts`). Examples are the store find-or-create in `LocationsService` and the booking in `ShipmentsService`.
- API integration tests (`test/<feature>-api.e2e-spec.ts`) boot only the feature module against their own test database and register the global pipe with `validationPipeOptions`. A module with a protected endpoint also needs `AuthModule`. `tokenFor(moduleRef, ...roles)` (`test/utils/test-auth.ts`) creates a user with those roles and signs a token for it.

### Protected endpoints

- `AuthGuard` (`modules/auth/auth.guard.ts`) reads `Authorization: Bearer`, verifies the token, and loads the user. It answers `401` unless the user is `ACTIVE` and not deleted. It then sets the request user to `{ id, roles }` with the roles from the database.
- `@Roles(...)` lists the roles that may call a handler; any one of the caller's roles is enough, otherwise `403`.
- Both are applied per handler with `@UseGuards(AuthGuard)` (or on the whole `UsersController`). Only the writes in [`domain-model.md` §4.2](./domain-model.md#42-user) have them; everything else is public.
- A module whose controller uses the guard imports `UsersModule`, because the guard needs `UsersService`. `JwtService` comes from the global `JwtModule` that `AuthModule` registers.
- `@CurrentUser()` gives a handler the caller, e.g. to stop a `SYS_ADMIN` from locking themselves.

### Lists: filtering, sorting and pagination

`GET /locations`, `GET /shipments` and `GET /users` work the same way:

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
  - A protected handler also has `@ApiBearerAuth()`, `@ApiUnauthorizedResponse` and `@ApiForbiddenResponse`. `swagger.config.ts` declares the `bearer` scheme, so Swagger UI has an Authorize button.
- **DTOs:** every property gets `@ApiProperty()`, or `@ApiPropertyOptional()` when it is optional. Enums use `{ enum, enumName }`. Nested objects use `{ type: NestedDto }`.
- **Response bodies** are classes, not interfaces, because Swagger can only describe classes. Example: `LocationResponse`.
- `config/swagger.config.spec.ts` generates the document without a database. It checks that every endpoint, response status, parameter, and required field is documented. When a controller is added, add it to this test.

Implemented DTOs: `CreateLocationDto`, `AddressDto`, `LocationCandidateDto`, `ListLocationsQueryDto`, and the `LocationResponse` / `LocationPageResponse` mappings (`locations/dto/`); `CreateShipmentDto`, `ShipmentEndpointDto`, `ListShipmentsQueryDto`, `UpdateShipmentCustomerDto`, `UpdateAppointmentsDto`, `ShipmentItemParamDto`, and `ShipmentResponse` / `BookShipmentResponse` / `ShipmentSummaryResponse` / `ShipmentPageResponse` / `ShipmentViewResponse` (`shipments/dto/`); `CreateItemDto`, `UpdateItemDto`, `DimensionsDto` and `ItemResponse` (`items/dto/`); `RouteResponse` (`routes/dto/`); `CreateUserDto`, `UpdateUserDto`, `ListUsersQueryDto`, and `UserResponse` / `UserPageResponse` (`users/dto/`); `LoginDto` and `LoginResponse` (`auth/dto/`); `UlidParamDto`, `PaginationQueryDto`, `PageResponse`, and `TimeWindowDto` / `TimeWindowResponse` (`common/dto/`). See [`business-workflows.md`](./business-workflows.md) for the workflows they serve.

## 5. Identifier strategy

- `id` (ULID string, unique index): the identifier used everywhere: references between documents, lookups (`findOne({ id })`), and the API.
- `_id` (ObjectId): MongoDB's default primary key. It is kept but not used by the application, and never stored in references.
- The ULID is generated by `generateUlid()` in `backend/src/common/utils/ulid.util.ts`, used as `@Prop({ default: generateUlid })`.
- `ulidValidator` in the same file is the Mongoose `validate` option for `id` and every reference field. `isValidUlid()` accepts only the canonical upper-case form. DTOs use `@IsUlid()`, which calls it.
- Because stored references and API values are the same ULIDs, services need no ID conversion. `populate` is not used, because it only follows `_id`. Related documents are loaded with explicit `findOne({ id })` / `find({ id: { $in: ids } })` queries.

See [`domain-model.md` §2](./domain-model.md#2-identifiers).

## 6. Configuration and local infrastructure

- Configuration uses `@nestjs/config` with environment variables. At minimum: `NODE_ENV`, `PORT`, `MONGODB_URI`.
- `CORS_ORIGIN` (default `http://localhost:4200`, the Angular dev server) is the one browser origin allowed to call the API; `main.ts` passes it to `app.enableCors()`.
- `backend/.env.example` documents the variables; `backend/.env` is local only and ignored by Git. `MONGODB_URI` is required; the app fails at startup with a clear message if it is missing.
- Local MongoDB runs with the root `docker-compose.yml` (`mongo:8.0`), exposed on `127.0.0.1:27018` (to avoid clashing with a local MongoDB on `27017`), with the named volume `cross-dock-management-mongodb-data`.
- Default local URI: `mongodb://localhost:27018/cross_dock_management`.
- A `GET /health` endpoint reports that the API process is running. It does not claim that MongoDB is healthy; a database health check may be added later.
- Authentication is implemented: a JWT bearer token signed with `@nestjs/jwt` and passwords hashed with `bcryptjs`. There are no sessions, no refresh tokens, no Passport, and no public registration. Roles and the endpoint table are in [`domain-model.md` §4.2](./domain-model.md#42-user).
  - `JWT_SECRET` is required. The app fails at startup with a message naming it when it is missing or empty.
  - On startup, when no non-deleted `SYS_ADMIN` exists and `AUTH_SEED_EMAIL`, `AUTH_SEED_PASSWORD` and `AUTH_SEED_NAME` are all set, `UsersService` creates that user as an `ACTIVE` `SYS_ADMIN`. When they are not all set, the app starts and logs a warning. When a `SYS_ADMIN` exists, it does nothing.
  - All four variables are documented in `backend/.env.example` without values and are never committed in `.env`.

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
8. Add DTO validation, services, APIs, and tests incrementally. *(in progress: validation setup, the Location service and API, shipment booking with items and cost (`POST /shipments/book`), routing of that shipment's delivery infos, list/detail endpoints for Locations and Shipments, the booking view, and the three booking-correction `PUT`s are done)*
9. Add authentication (token login, user management by `SYS_ADMIN`, guards on the writes in [`domain-model.md` §4.2](./domain-model.md#42-user)). *(done, including the frontend login screen)* Scanning stays a later step ([`scanning-flows.md`](./scanning-flows.md)).

Each step should build, lint, and (where tests exist) pass tests before moving to the next.

Schema steps add two kinds of tests:

- `src/**/<name>.schema.spec.ts` (`npm test`): schema definition and in-memory validation, no database.
- `test/*.e2e-spec.ts` (`npm run test:e2e`): integration against MongoDB (indexes, duplicate keys, timestamps). Each file uses its own `cross_dock_management_test_<name>` database through `test/utils/test-database.ts`. Jest runs files in parallel and each file drops its database when it finishes, so two files must never share a database.

## 9. Frontend

The frontend is an Angular 21 application in `frontend/`. Angular 21 (LTS) is the newest major whose CLI supports the project's Node.js 22.14. It is a standalone-component app with no UI library, no Tailwind, and no Angular Material. Every page except `/login` requires a logged-in user. It has no form that creates records. The only writes are the three corrections on the booking detail page, which the API accepts from an `ADMIN` or `SYS_ADMIN` token only.

```text
frontend/src/
├── environments/environment.ts  # apiBaseUrl (default http://localhost:3100)
├── styles.css                  # the only stylesheet
└── app/
    ├── app.ts / app.html       # shell: header with navigation and the user, <router-outlet>
    ├── app.config.ts           # router, the one HttpClient (with authInterceptor), date format
    ├── app.routes.ts           # /login, and one lazy, guarded route per feature: /shipments, /locations
    ├── auth/
    │   ├── session.ts          # Session: the token and user, kept in localStorage until expiry
    │   ├── auth.interceptor.ts # sends Authorization: Bearer; a 401 ends the session
    │   ├── logged-in.guard.ts  # not logged in → /login?returnUrl=…
    │   └── login.ts / .html    # the login page
    ├── api/
    │   ├── api.models.ts       # response types, mirroring the backend *Response classes
    │   ├── api.service.ts      # ApiService: the only class calling the API; errorMessage()
    │   └── load-state.ts       # load(): loading → loaded | error, for every page
    ├── shared/
    │   ├── list-query.ts       # URL query ⇄ API list query (filters, page)
    │   └── pager.ts            # Previous / Next for both lists
    ├── shipments/              # shipments.routes.ts, shipment-list, shipment-detail
    └── locations/              # locations.routes.ts, location-list, location-detail
```

- **Login:** `/login` posts the email and password to `POST /auth/login` through `ApiService.login()`.
  - On success, `Session` stores the `accessToken`, its expiry (`expiresIn` from now) and the user in `localStorage`, so a reload or a new tab stays logged in. The page then opens the `returnUrl` (only a path inside the app) or `/shipments`. On failure it shows the API's error, and the button is disabled while the request runs.
  - `loggedInGuard` sends a visitor who is not logged in, or whose token has expired, to `/login?returnUrl=…`.
  - `authInterceptor` adds `Authorization: Bearer <token>` to every API request while logged in. A `401` on such a request (an expired token or a deactivated user) ends the session and opens `/login`, with "Your session has ended" and the page to return to. A `403` (a role that may not edit) is shown as the editor's error.
  - The header shows the navigation, the user's name and roles, and Log out only while logged in. Log out removes the session and opens `/login`; there is no logout endpoint, since tokens are stateless.
- **Pages:** each feature has a list (`/shipments`, `/locations`) and a detail page (`/shipments/:id`, `/locations/:id`).
  - A list calls `GET /<feature>` with the filters from its form. The code or name in a row links to the detail page.
  - The Locations pages call `GET /locations` and `GET /locations/:id`.
  - The shipments list shows bookings only. It always sends `isRoot=true`, and opening it without `isRoot=true` in the URL replaces the URL with one that has it. Its filters are code, customer and status. Each row shows the code, status and "Not routed" when there is no `TRANSIT` point, then the origin → destination stores, the two appointments, and the customer, cost and items (three items, then "+N").
  - The booking detail calls `GET /shipments/:id/view`. It shows the path, the items, and each leg with its routes. Location names link to their Location.
  - On a `CREATED` booking it can edit the customer name, the pickup or drop-off window (the `PUT` always sends both), and one item. One editor is open at a time. Save is disabled while it runs, the page reloads the view on success, and an error is shown above the editor. A `TRANSIT` row and a route's Edit stay disabled, and every Edit is disabled on a booking that is not `CREATED`.
- **State in the URL:** a list's filters and page are query parameters, e.g. `/shipments?isRoot=true&page=2`. Each change of the URL loads the list again, so reload and the back button keep the list. The page size is fixed at 20.
- **Loading, empty, error:** every page shows `Loading…`, then the data, a "No … found." line, or the error. The error text is the `message` from Nest's error body (validation messages joined with `;`), or "Cannot reach the API" when there is no response.
- **Styling:** `styles.css` is the only stylesheet; components have none. The `@schematics/angular:component` default in `angular.json` is `style: none`.
  - `:root` variables: text, muted, background, accent, and error colours, one spacing step, and one border.
  - No rounded corners, shadows or gradients.
  - The accent marks only the active navigation item, the primary button, and the arrow between origin and destination in the shipments list.
- **Commands** (in `frontend/`): `npm start` (dev server on <http://localhost:4200>), `npm run build`, `npm test` (Vitest).
