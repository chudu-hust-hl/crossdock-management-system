# Schema Design

Field-level Mongoose design for the six domain collections: types, required fields, defaults, enums, references, embedded documents, and indexes. Domain concepts and the reasons behind them are in [`domain-model.md`](./domain-model.md); this document does not repeat them.

All six schemas are **implemented** in `backend/src/modules/<module>/schemas/`, and each is registered with `MongooseModule.forFeature` in its own feature module. The supporting `metadata` collection is described in §11. The implemented APIs are listed in [`business-workflows.md`](./business-workflows.md) (§6 Locations, §7 Shipments).

| Collection | Model | Schema file |
| --- | --- | --- |
| `locations` | `Location` | `locations/schemas/location.schema.ts` (+ `address.schema.ts`) |
| `users` | `User` | `users/schemas/user.schema.ts` |
| `items` | `Item` | `items/schemas/item.schema.ts` (+ `dimensions.schema.ts`) |
| `shipments` | `Shipment` | `shipments/schemas/shipment.schema.ts` (+ `delivery-info.schema.ts`) |
| `routes` | `Route` | `routes/schemas/route.schema.ts` (+ `route-stop.schema.ts`) |
| `dock_tasks` | `DockTask` | `dock-tasks/schemas/dock-task.schema.ts` |

## 1. Conventions for every collection

| Concern | Convention |
| --- | --- |
| `_id` | Mongoose default `ObjectId`. Never overridden or replaced, and not used by the application or referenced by other documents. |
| `id` | `String`, `required`, `unique`, `immutable`, `default: generateUlid`, `validate: ulidValidator` (both from `common/utils/ulid.util.ts`). |
| Collection name | Set explicitly with `@Schema({ collection })`. Otherwise Mongoose would pluralise `DockTask` to `docktasks`. |
| Timestamps | `@Schema({ timestamps: true })`. `createdAt` / `updatedAt` are declared as class properties, **not** with `@Prop`. |
| References | The target's ULID `id`: `{ type: String, validate: ulidValidator }`, or `[{ type: String, validate: ulidValidator }]` for arrays. Never an ObjectId and no `ref` option: `ref` / `populate` only work with `_id`. A doc comment on each field names the target model. Schema files never import each other. |
| Nullable vs optional | Fields described as *nullable* default to `null` (`parentId`, leg references, `performedBy`, `completedAt`, time-window ends). Fields described as *optional* have no default and are omitted when unset. |
| Required strings | `required: true, trim: true`. Mongoose treats `''` as missing and trims before validating, so whitespace-only values are rejected. |
| Optional strings | `trim: true`. No format validation that could reject legitimate international data. |
| Enums | TypeScript string enums used as `enum: Object.values(MyEnum)`. An enum used by one module lives in that module's `enums/`. An enum shared by several modules lives in `common/enums/`. |
| `metadata` | Optional `Mixed`, typed `Record<string, unknown>`. Only for non-core extension data. After changing a nested value in place, call `doc.markModified('metadata')`. |
| Unique constraints | Declared once, with `unique: true` on the `@Prop`. Query (non-unique) indexes are declared with `XSchema.index(...)` directly below the schema. |
| Embedded value objects | `@Schema({ _id: false })` with no ULID. They are part of their parent document, not standalone entities. Ordered lists (delivery infos, route stops) are identified by `sequence`. |
| TypeScript | TypeScript 6 is strict by default, so required properties use `!` (Mongoose never calls the class constructor). Optional properties use `?`. |
| Soft delete | Every schema has `deletedAt: Date \| null`, default `null`. It is not repeated in the field tables below. No middleware hides deleted documents; services filter with `{ deletedAt: null }`. Unique indexes stay global, so a deleted document keeps its unique values. |
| Business codes | `itemCode`, `code`, `routeNumber`, and `taskNumber` are validated with `match` against the patterns in `common/constants/business-code-patterns.ts`. The schema checks the format only; generating codes is a service task. |
| Middleware | None. No hooks, plugins, or virtuals. |

### Mongoose's `id` virtual

By default Mongoose adds an `id` virtual that returns `_id` as a string. Because each schema declares a real `id` path, Mongoose skips the virtual and `doc.id` returns the ULID.

Mongoose's `Document` type still declares `id` as `any`. Where a typed string is needed, use `doc.get('id')` or a `.lean()` result.

### What the schema layer guarantees, and what it does not

- **Validators run on `save()`, `create()`, and `validate()`.** They do not run on update queries (`updateOne`, `findOneAndUpdate`, ...) unless `runValidators: true` is passed. Validators that use `this` (the `TimeWindow` order check, the Shipment self-parent check) are written for document validation.
- **Uniqueness is enforced by MongoDB unique indexes**, which Mongoose creates through `autoIndex` (on by default). Mongoose validation alone cannot guarantee uniqueness under concurrent writes. Duplicate inserts fail with error code `11000`, which services must translate into a meaningful API error.
- **ULID references are format-checked only.** `ulidValidator` rejects ObjectIds, lower-case ULIDs, and other strings. It does not check that the referenced document exists.
- **No referential integrity.** Neither Mongoose nor MongoDB checks that a referenced document exists (an integration test demonstrates this). Services must check references by looking them up with `findOne({ id })`.
- **Array indexes are multikey indexes.** `itemIds` and `shipmentIds` indexes speed up "which documents contain X" queries. They do not enforce rules such as "a shipment segment belongs to only one route".

## 2. Shared supporting types (`backend/src/common/`)

### `TimeWindow` — `schemas/time-window.schema.ts`

Used for every `appointment` and `actualWindow` (Shipment delivery infos, Route, route stops). The window object is always present (`required`, default `{}`); its ends are `null` until known.

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `from` | `Date` | no | `null` |
| `to` | `Date` | no | `null` |

Validation: when both are set, `from <= to`. The check is declared on both paths, so changing either end re-validates the order.

### Shared enums — `enums/`

| Enum | Values | Used by |
| --- | --- | --- |
| `DeliveryPointType` | `PICKUP`, `TRANSIT`, `DROPOFF` | `DeliveryInfo.type`, `RouteStop.type` |
| `DeliveryPointStatus` | `PENDING`, `ARRIVED`, `PROCESSING`, `COMPLETED`, `SKIPPED` | `DeliveryInfo.status`, `RouteStop.status` |

A delivery info and a route stop are both "a visit to a location at a position in an ordered sequence", so they share one type enum and one status enum instead of two identical pairs.

### `hasUniqueSequences` — `utils/sequence.util.ts`

Array validator used by `Shipment.deliveryInfos` and `Route.stops`: two entries may not share a `sequence`.

### Business code patterns — `constants/business-code-patterns.ts`

Regular expressions for the formats in [`domain-model.md` §3](./domain-model.md#business-codes). Every code ends with `-MMYY`, where `MM` is a month from `01` to `12` and `YY` is the two-digit year. The counter before it has at least 4 digits (zero-padded).

| Constant | Field | Pattern (simplified) |
| --- | --- | --- |
| `ITEM_CODE_PATTERN` | `Item.itemCode` | `T-<nnnn>-MMYY` |
| `SHIPMENT_CODE_PATTERN` | `Shipment.code` | `S-<nnnn>-MMYY` |
| `ROUTE_NUMBER_PATTERN` | `Route.routeNumber` | `R-<nnnn>-MMYY` |
| `TASK_NUMBER_PATTERN` | `DockTask.taskNumber` | `<nnnn>-MMYY` |

### Business code formatting — `utils/business-code.util.ts`

- `formatBusinessCode(type, counter, date)` returns e.g. `T-0001-1026` for `(BusinessCodeType.ITEM, 1, <a date in October 2026>)`. It rejects counters that are not positive integers.
- `businessCodePeriod(date)` returns the `MMYY` period in Vietnam time (UTC+7). Services use it to know when a counter restarts.
- `BusinessCodeType` (`common/enums/`): `ITEM`, `SHIPMENT`, `ROUTE`, `DOCK_TASK`. These map to the prefixes `T-`, `S-`, `R-`, and none.
- Both functions are pure: they do not read or store the counter.

## 3. `locations`

`@Schema({ collection: 'locations', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `name` | `String` | yes | | trimmed |
| `type` | `LocationType` | yes | | `WAREHOUSE`, `CROSS_DOCK`, `STORE`, `CUSTOMER`; no `DOCK` (dock doors are not modelled) |
| `address` | `Address` (embedded) | yes | | see below |
| `contactName` | `String` | no | | trimmed |
| `contactPhone` | `String` | no | | trimmed; no format check |
| `status` | `LocationStatus` | yes | `ACTIVE` | `ACTIVE`, `INACTIVE` |
| `metadata` | `Mixed` | no | | |

`Address` (`_id: false`): `addressLine1` (required), `addressLine2`, `ward`, `district`, `city`, `province`, `postalCode` (required, because it is part of the Location reuse rule in [`business-workflows.md`](./business-workflows.md#2-location-reuse-rule)), `country`. All strings are trimmed. No coordinates or geospatial indexes.

`contactName` is optional in the schema, but `CreateLocationDto` requires it for a `STORE`.

There is no `locationCode`. A location is identified by its `id`.

**Indexes:**

- `{ id: 1 }` unique.
- `store_identity`: `{ name: 1, contactName: 1, 'address.postalCode': 1 }` unique, with collation `{ locale: 'vi', strength: 2 }` (case-insensitive, accent-sensitive) and `partialFilterExpression: { type: 'STORE', deletedAt: null }`. This index enforces the store reuse rule ([`business-workflows.md` §2](./business-workflows.md#2-location-reuse-rule)). Other types and soft-deleted stores are not in the index. Queries must pass the same collation to match case-insensitively and to use the index.

## 4. `users`

`@Schema({ collection: 'users', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `fullName` | `String` | yes | | trimmed |
| `email` | `String` | yes | | unique, trimmed, **lower-cased**, so case variants collide on the unique index |
| `passwordHash` | `String` | no | | Reserved for future internal authentication; never a plaintext password. `select: false`: excluded from queries unless `.select('+passwordHash')`. |
| `roles` | `UserRole[]` | yes | `[]` | `ADMIN`, `OPERATIONS_MANAGER`, `WAREHOUSE_STAFF`; may be empty |
| `status` | `UserStatus` | yes | `ACTIVE` | `ACTIVE`, `INACTIVE`, `LOCKED` |
| `lastLoginAt` | `Date` | no | | |

**Indexes:** `{ id: 1 }` unique, `{ email: 1 }` unique.

## 5. `items`

`@Schema({ collection: 'items', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `itemCode` | `String` | yes | | unique, trimmed, `T-<nnnn>-MMYY` |
| `barcode` | `String` | yes | | unique, trimmed |
| `description` | `String` | no | | trimmed |
| `itemUnit` | `ItemUnit` | yes | | `BOX`, `PALLET`, `KEG`, `BAG` |
| `status` | `ItemStatus` | yes | `CREATED` | `CREATED`, `IN_TRANSIT`, `AT_DOCK`, `DELIVERED`, `EXCEPTION` |
| `currentLocationId` | `String` (ULID) → `Location` | no | | |
| `currentShipmentId` | `String` (ULID) → `Shipment` | no | | the shipment (segment) currently carrying the item |
| `weight` | `Number` | no | | `min: 0` |
| `weightUnit` | `WeightUnit` | when `weight` is set | | `KG`, `LB` |
| `dimensions` | `Dimensions` (embedded) | no | | see below |
| `metadata` | `Mixed` | no | | |

`Dimensions` (`_id: false`) is optional as a whole, but complete when present: `length`, `width`, `height` (`Number`, required, `min: 0`) and `unit` (`DimensionUnit`: `CM`, `IN`, required).

No shipment history is stored on the Item. History comes from DockTask records.

**Indexes:** `{ id: 1 }`, `{ itemCode: 1 }`, `{ barcode: 1 }` unique; `{ currentLocationId: 1, status: 1 }` ("items at this location in this state").

## 6. `shipments`

`@Schema({ collection: 'shipments', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `code` | `String` | yes | | unique, trimmed, `S-<nnnn>-MMYY` |
| `parentId` | `String` (ULID) → `Shipment` | no | `null` | `null` = root shipment. Must not equal the document's own `id`. |
| `childrenIds` | `String[]` (ULIDs) → `Shipment` | no | `[]` | Child shipments in path order. Empty until they are created. Each listed id has `parentId` equal to this document's `id`. |
| `customerName` | `String` | on a root shipment | | trimmed |
| `cost` | `Number` | on a root shipment | | `min: 0`; whole VND, calculated at booking |
| `itemIds` | `String[]` (ULIDs) → `Item` | no | `[]` | the items in this shipment or segment |
| `deliveryInfos` | `DeliveryInfo[]` (embedded) | no | `[]` | sequences must be unique |
| `status` | `ShipmentStatus` | yes | `CREATED` | `CREATED`, `IN_TRANSIT`, `AT_DOCK`, `DELIVERED`, `CANCELLED`, `EXCEPTION` |
| `metadata` | `Mixed` | no | | |

`customerName` and `cost` describe the booking, so they are required only when `parentId` is `null`. Segments (legs) do not repeat them.

**Not stored:** `shipmentNumber`, `origin`, `destination`, `originLocationId`, `destinationLocationId`. `childrenIds` is stored so a parent can be read without a second query; the service keeps it equal to the children found by `parentId`.

`DeliveryInfo` (`_id: false`):

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `sequence` | `Number` | yes | | integer ≥ 1 |
| `locationId` | `String` (ULID) → `Location` | yes | | |
| `type` | `DeliveryPointType` | yes | | |
| `appointment` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `actualWindow` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `status` | `DeliveryPointStatus` | yes | `PENDING` | |
| `metadata` | `Mixed` | no | | |

**Indexes:** `{ id: 1 }`, `{ code: 1 }` unique; `{ parentId: 1 }` (segments of a shipment); multikey `{ itemIds: 1 }` (shipments containing an item); `{ status: 1, updatedAt: -1 }` (recent shipments by status).

## 7. `routes`

`@Schema({ collection: 'routes', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `routeNumber` | `String` | yes | | unique, trimmed, `R-<nnnn>-MMYY` |
| `shipmentIds` | `String[]` (ULIDs) → `Shipment` | no | `[]` | shipment segments carried by the route |
| `items` | `RouteItem[]` (embedded) | no | `[]` | scan snapshot copied at assignment; no `status` or `currentLocationId` |
| `stops` | `RouteStop[]` (embedded) | no | `[]` | sequences must be unique; no RouteStop collection |
| `fromLocationId` | `String` (ULID) → `Location` | yes | | first stop; with `toLocationId`, `serviceDate`, and `slot` it identifies a dock–dock route |
| `toLocationId` | `String` (ULID) → `Location` | yes | | second stop |
| `serviceDate` | `String` | on a dock–dock route | | `YYYY-MM-DD` in Vietnam time (UTC+7). Omitted on a store–dock route. |
| `slot` | `String` | on a dock–dock route | | `MORNING` or `EVENING`. Omitted on a store–dock route. |
| `status` | `RouteStatus` | yes | `PLANNED` | `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| `appointment` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `actualWindow` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `driverName` | `String` | yes | | trimmed plain text. Placeholder until dispatch: `Nguyen Van Tai`. |
| `vehiclePlate` | `String` | yes | | trimmed plain text. Placeholder until dispatch: `29A-000.01`. |
| `createdBy` | `String` (ULID) → `User` | yes | | Placeholder until users exist: `01ARZ3NDEKTSV4RRFFQ69G5FAV`. |
| `metadata` | `Mixed` | no | | |

`RouteItem` (`_id: false`): `itemId`, `shipmentId` (the child shipment), `itemCode`, `barcode`, optional `description`, `itemUnit`, `weight`, `weightUnit`. Copied from the Item documents at assignment. Not updated when a scan changes the Item. A booking correction of the Item (`PUT /shipments/:id/items/:itemId`, [`business-workflows.md` §7.2](./business-workflows.md#72-correcting-a-booking)) rewrites `description`, `itemUnit`, `weight` and `weightUnit`; `itemCode` and `barcode` never change.

No `plannedStartAt` / `plannedEndAt` / `actualStartAt` / `actualEndAt`.

`RouteStop` (`_id: false`):

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `sequence` | `Number` | yes | | integer ≥ 1 |
| `locationId` | `String` (ULID) → `Location` | yes | | |
| `type` | `DeliveryPointType` | yes | | |
| `shipmentIds` | `String[]` (ULIDs) → `Shipment` | no | `[]` | segments handled at this stop |
| `appointment` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `actualWindow` | `TimeWindow` | yes | `{ from: null, to: null }` | |
| `status` | `DeliveryPointStatus` | yes | `PENDING` | |

**Indexes:** `{ id: 1 }`, `{ routeNumber: 1 }` unique; multikey `{ shipmentIds: 1 }` (routes carrying a segment); `{ status: 1, 'appointment.from': 1 }` (upcoming routes by status). Unique partial index on `fromLocationId` + `toLocationId` + `serviceDate` + `slot` where `slot` is set and `deletedAt` is null, so one open dock–dock route exists per direction, day, and slot.

## 8. `dock_tasks`

`@Schema({ collection: 'dock_tasks', timestamps: true })`

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `taskNumber` | `String` | yes | | unique, trimmed, `<nnnn>-MMYY` |
| `itemId` | `String` (ULID) → `Item` | yes | | exactly one item per task |
| `shipmentId` | `String` (ULID) → `Shipment` | yes | | |
| `routeId` | `String` (ULID) → `Route` | yes | | |
| `locationId` | `String` (ULID) → `Location` | yes | | where the action happens |
| `inboundLegId` | `String` (ULID) → `Shipment` | no | `null` | leg (child shipment) on which the item arrived |
| `outboundLegId` | `String` (ULID) → `Shipment` | no | `null` | leg (child shipment) on which the item leaves |
| `type` | `DockTaskType` | yes | | `SCAN_INBOUND`, `SCAN_OUTBOUND`, `PHOTO`, `INSPECTION`, `EXCEPTION` |
| `status` | `DockTaskStatus` | yes | `PENDING` | `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `performedBy` | `String` (ULID) → `User` | no | `null` | |
| `completedAt` | `Date` | no | `null` | |
| `metadata` | `Mixed` | no | | |
| `errorCode` | `String` | no | | trimmed |
| `errorMessage` | `String` | no | | trimmed |

**Indexes:** `{ id: 1 }`, `{ taskNumber: 1 }` unique; `{ itemId: 1, createdAt: -1 }` (item history, newest first); `{ routeId: 1, locationId: 1, status: 1 }` (work queue at a stop); `{ shipmentId: 1, type: 1, status: 1 }` (tasks of a shipment by type and state).

## 9. Integrity rules for the service layer

These rules span documents, or depend on workflow state, so the schemas cannot enforce them. They must be implemented and tested in services.

**References (all collections)**

- Every referenced ULID exists in the right collection and is not soft-deleted. For example, `inboundLegId` points to a shipment segment and `locationId` to an `ACTIVE` location. Look the target up with `findOne({ id, deletedAt: null })`.
- ULIDs from the API are stored as they are; there is no conversion step.
- Duplicate-key errors (`11000`) are translated into clear API errors.

**Soft delete (all collections)**

- Deleting sets `deletedAt`; documents are never removed. Exception: the undo of a failed booking hard-deletes the Items and stores that booking created ([`business-workflows.md` §4.4](./business-workflows.md#44-failure-handling)).
- Reads exclude documents whose `deletedAt` is set, unless a feature explicitly needs them (for example, history).
- New references to soft-deleted documents are rejected.

**Business codes**

- `itemCode`, `code`, `routeNumber`, and `taskNumber` are generated with `MetadataService.nextBusinessCode(type, date)`. It increments one counter per code type and month in the `metadata` collection (§11) and formats the result with `formatBusinessCode()`. Shipment `code` and Item `itemCode` use it today; a booking reserves all its item codes in one step with `nextBusinessCodes(type, date, count)`.

**Shipment**

- `parentId` references an existing shipment and creates no cycle (the schema only rejects a shipment that is its own parent).
- Every `deliveryInfos[].locationId` references an existing, non-deleted Location.
- `deliveryInfos` are kept in `sequence` order when written.
- Segments reuse the existing Item documents; they never copy items.
- A root shipment's Items are created by its booking; a booking never references existing Items.

**Item**

- At booking, `currentLocationId` is the pickup Location and `currentShipmentId` the new root shipment.
- Afterwards, `currentLocationId` / `currentShipmentId` are updated by operational processing (dock tasks).
- `barcode` is unique across all Items, including soft-deleted ones; a booking rejects a registered barcode with `409`.
- `currentShipmentId` refers to a shipment whose `itemIds` contains the item.

**Route**

- Each stop's `shipmentIds` is contained in the route's `shipmentIds`.
- Every `stops[].locationId` references an existing, non-deleted Location.
- Stops are synchronised with the segments' `deliveryInfos` by explicit service logic, not by schema middleware.
- A segment belongs to one non-deleted route (the multikey index does not prevent a second one; the service checks).
- On a dock–dock route, `fromLocationId`, `toLocationId`, `serviceDate`, and `slot` match the two stops, the Vietnam day, and the morning or evening window ([`business-workflows.md` §5](./business-workflows.md#5-routing)).

**DockTask**

- Which leg references each task type requires (for example, `SCAN_INBOUND` with `inboundLegId`).
- The item belongs to `shipmentId`, and the shipment belongs to `routeId`.
- `performedBy` and `completedAt` are set when a task is completed. Completed tasks are not overwritten, because they are the item's history.

**User**

- Authentication, password hashing, and role-based authorization (later tasks).

## 10. Decisions to confirm

1. `RouteStatus` values `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` were chosen in this step; the task did not specify them.
2. Delivery infos reuse the route-stop status values (`DeliveryPointStatus`).
3. Default statuses: Item and Shipment `CREATED`, Route `PLANNED`, DockTask `PENDING`, delivery infos and stops `PENDING`.
4. Unit sets: weight `KG` / `LB`, dimensions `CM` / `IN`.
5. `sequence` is an integer ≥ 1.
6. Soft delete is stored as a nullable `deletedAt` date rather than an `isDeleted` flag, so the deletion time is recorded too.
7. The `MMYY` period of business codes is taken in Vietnam time (UTC+7), not UTC, so codes follow the local calendar month.
8. References store ULID strings instead of ObjectIds, so that one identifier is used everywhere, with no conversion between ULIDs and ObjectIds. The trade-offs are slightly larger keys (26 characters instead of 12 bytes) and no Mongoose `populate`.
9. Multi-document operations need MongoDB transactions to be atomic. Transactions require a replica set; the local Docker MongoDB is a standalone server.
   - Booking does not use a transaction. It uses ordered writes with compensation: checks first, the Shipment last, and an undo of its own writes on failure ([`business-workflows.md` §4.4](./business-workflows.md#44-failure-handling)).
   - Switching to a replica set and transactions would remove the remaining limitations. To decide before implementing the dock-task services (e.g. completing a dock task and updating the item's current location).

## 11. `metadata`

`@Schema({ collection: 'metadata', timestamps: true })`, in `metadata/schemas/metadata.schema.ts`. A small key-value store for values and rules that may change (`domain-model.md` question 16). It is not a domain entity of its own, but it follows the same conventions (`id`, soft delete, timestamps).

| Field | Type | Required | Default | Constraints / notes |
| --- | --- | --- | --- | --- |
| `id` | `String` | yes | `generateUlid()` | common `id` convention |
| `scope` | `MetadataScope` | yes | | groups entries; today only `BUSINESS_CODE_COUNTER` |
| `key` | `String` | yes | | trimmed; unique within its scope, e.g. `SHIPMENT-1026` |
| `value` | `Mixed` | yes | | shape depends on the scope; a number for a counter |

**Indexes:** `{ id: 1 }` unique; `{ scope: 1, key: 1 }` unique.

**Counters:**

- `MetadataService.nextBusinessCode()` runs `findOneAndUpdate({ scope, key }, { $inc: { value: 1 } }, { upsert: true, new: true })`.
- The first call of a month creates the entry with `value: 1`.
- Because the filter is an equality match on the unique `{ scope, key }` index, MongoDB retries an upsert that loses a race. Concurrent callers therefore get distinct values; an integration test checks 10 concurrent calls.
- Counters are never reset or decremented, so a code number is skipped if the document it was generated for is not saved.
