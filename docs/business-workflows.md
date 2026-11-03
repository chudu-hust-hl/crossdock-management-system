# Business Workflows

This document records business processes that span several collections: how Locations enter the system, how they are reused, how a Shipment is created, and where routing fits. Entities, fields, and naming are defined in [`domain-model.md`](./domain-model.md). Open questions are kept in the single list in [`domain-model.md`](./domain-model.md#open-questions).

**Status:**
- The Location API and the Location reuse rule are implemented (§2, §6).
- Shipment booking (shipment, items, cost) is implemented (§4, §7).
- Listing (filtered, sorted, paginated) and detail lookup of Locations and Shipments are implemented (§6, §7).
- Routing is not implemented yet (§5).

## 1. Location creation sources

| Source | Request shape | Location type | Status |
| --- | --- | --- | --- |
| An administrator creates a Location manually | `CreateLocationDto` via `POST /locations` | Chosen by the administrator. Cross-docks are created this way. | Implemented |
| A user books a Shipment and supplies its pickup and drop-off locations | `LocationCandidateDto` inside `CreateShipmentDto` | `STORE`, set by `LocationsService.resolveCandidate()` | Implemented (`POST /shipments/book`) |
| An external system sends shipment data through an API integration | Expected to reuse `LocationCandidateDto` | `STORE` | Future feature, not implemented |
| Shipment data is imported from an Excel file | Expected to reuse `LocationCandidateDto` | `STORE` | Future feature, not implemented |

The reuse rule in §2 applies to every `STORE`, whatever its source. This includes an administrator creating a `STORE` manually: when it matches an existing store, the existing one is returned. Other types (`CROSS_DOCK`, `WAREHOUSE`, `CUSTOMER`) are created as requested, with no deduplication.

## 2. Location reuse rule

When the system receives a `STORE` (for example a shipment's pickup), it reuses an existing store instead of creating a duplicate. Only `STORE` Locations take part in the rule. A `CROSS_DOCK` with the same values is a different Location, and so is a soft-deleted store.

**Identity.** Two stores are the same store when **all three** of these fields match:

- `name`
- `contactName`
- `address.postalCode`

A match on only one or two of the fields is **not** a match. That is why `LocationCandidateDto` requires all three fields, and why `CreateLocationDto` requires `contactName` when `type` is `STORE`.

**Normalization** (`normalizeIdentityText()` and `LOCATION_IDENTITY_COLLATION` in `locations/location-identity.ts`):

1. **Whitespace:** leading and trailing whitespace is removed, and inner runs of whitespace (spaces, tabs, line breaks) become one space. The text is also converted to one Unicode form (NFC). These normalized values are what gets **stored**.
2. **Case:** the comparison is case-insensitive (`Store A` matches `STORE A`). Stored values keep the letter case that was first entered. The case-insensitive comparison comes from the MongoDB collation `{ locale: 'vi', strength: 2 }`, used by both the lookup query and the unique index.
3. **Nothing else:** Vietnamese diacritics are significant (`Nguyễn` does not match `Nguyen`), and punctuation is kept.

**How it is enforced:**

- **Unique index:** `store_identity` is a compound unique index on `name` + `contactName` + `address.postalCode`, with the collation above and the partial filter `{ type: 'STORE', deletedAt: null }`. MongoDB itself guarantees at most one non-deleted store per identity, even under concurrent requests.
- **Not single-field indexes:** there is no unique index on any single field. `name` alone is not unique.
- **No fuzzy matching:** there is no fuzzy matching, geocoding, address-distance matching, or external lookup.

**Result of the lookup:**

- **Match found:** the existing store is reused as it is, including an `INACTIVE` one. Its contact phone, address lines, status, and other details are **not** overwritten, even if the new values differ. Updating an existing Location requires a separate, explicit business rule.
- **No match:** a new `STORE` is created (status `ACTIVE` unless the administrator chose otherwise).
- **Soft-deleted stores** (`deletedAt` set) are never reused.

**Concurrency** (find-or-create in `LocationsService`):

1. Look up the store with the normalized values and the collation.
2. If none is found, insert it.
3. If two requests insert the same store at the same moment, the unique index rejects the second insert with duplicate-key error `11000`. The service then reads the store the first request created and returns it as a match. An integration test sends five concurrent requests and checks that exactly one store is created.

## 3. Location types in the current workflow

| Type | Business role | Created by |
| --- | --- | --- |
| `STORE` | Customer pickup or drop-off location | The shipment workflow, or an administrator; always through the reuse rule (§2) |
| `CROSS_DOCK` | Cross-dock facility managed by the administrator; a candidate stop for routing (§5) | An administrator, manually |
| `WAREHOUSE`, `CUSTOMER` | Kept from the original design but not used by any workflow yet | An administrator, manually |

A cross-dock facility is a Location with `type: CROSS_DOCK`. There is no separate Warehouse or cross-dock collection, and dock doors are not modelled.

## 4. Shipment booking

Booking creates a root Shipment together with its Items, in one request (`POST /shipments/book`).

### 4.1 Request

`CreateShipmentDto` (`backend/src/modules/shipments/dto/`) describes what the user supplies:

- the customer name;
- the two endpoints, each with a Location candidate and an appointment window;
- the items, at least one;
- optional metadata.

```json
{
  "customerName": "Cong ty TNHH ABC",
  "pickup": {
    "location": {
      "name": "Store A",
      "contactName": "Nguyen Van A",
      "contactPhone": "0901234567",
      "address": { "addressLine1": "1 Dai Co Viet", "city": "Hanoi", "postalCode": "100000" }
    },
    "appointment": { "from": "2026-10-27T08:00:00+07:00", "to": "2026-10-27T10:00:00+07:00" }
  },
  "dropoff": {
    "location": {
      "name": "Store B",
      "contactName": "Tran Thi B",
      "address": { "addressLine1": "12 Le Loi", "city": "Ho Chi Minh City", "postalCode": "700000" }
    },
    "appointment": { "from": "2026-10-29T13:00:00+07:00", "to": "2026-10-29T17:00:00+07:00" }
  },
  "items": [
    {
      "barcode": "8930000000017",
      "itemUnit": "BOX",
      "description": "Carton of books",
      "weight": 2.5,
      "weightUnit": "KG",
      "dimensions": { "length": 40, "width": 30, "height": 20, "unit": "CM" }
    },
    { "barcode": "8930000000024", "itemUnit": "PALLET", "weight": 120, "weightUnit": "KG" }
  ],
  "metadata": {}
}
```

- `customerName` is required and trimmed; a blank name is rejected.
- `pickup.location` and `dropoff.location` are Location candidates (`LocationCandidateDto`). The caller never sends an ObjectId or an existing Location reference.
- **Items** (`CreateItemDto`, `backend/src/modules/items/dto/`):
  - Every item is a **new** physical item, described in full. A booking never references Items that already exist, so there is no `itemIds` field.
  - Required: `barcode`, `itemUnit` (`BOX`, `PALLET`, `KEG`, `BAG`), `weight` (positive) and `weightUnit` (`KG`, `LB`).
  - Optional: `description`, `dimensions` (`length`, `width`, `height` positive, plus `unit`) and `metadata`.
  - Barcodes must be different within the request.
- The global `ValidationPipe` rejects any field the DTO does not declare with `400 Bad Request`. These fields are therefore refused:
  - `_id`, `id`, `code`, `status`, `parentId`, `childrenIds`, `deliveryInfos`, `cost`, `itemIds`
  - route IDs and route stops
  - location references or `type` / `status` on the candidates
  - an item's `itemCode`, `status` or current location / shipment
- The caller does not submit the cross-dock route. Intermediate stops are decided by routing (§5), unless a future requirement adds manual route selection.
- **Appointments:** each endpoint's `appointment: { from, to }` is supplied **when the shipment is created** and is required.
  - `TimeWindowDto` requires both ends as ISO 8601 date-times, and `to` must not be earlier than `from` (`@IsNotBefore('from')`).
  - The values are stored as UTC `Date`s.

### 4.2 Workflow (implemented in `ShipmentsService.create()`)

1. **Validate the request.** The `ValidationPipe` and DTOs check the request's structure.
2. **Check the barcodes.** No Item may already have one of the barcodes, including a soft-deleted one (`ItemsService.findUsedBarcodes()`). Otherwise the response is `409` "Barcodes already registered: …". This is what guarantees that an Item is never booked twice.
3. **Calculate the cost** (§4.3). If pricing is not configured, the response is `503`.
4. **Resolve the pickup Location** with `LocationsService.resolveCandidate()` (§2). This reuses a matching `STORE` or creates one. A shipment may only use an `ACTIVE` Location ([`schema-design.md` §9](./schema-design.md#9-integrity-rules-for-the-service-layer)). A reused `INACTIVE` store is rejected with `400`.
5. **Resolve the drop-off Location** the same way. The request is **rejected** (`400`) if pickup and drop-off resolve to the same Location.
6. **Generate the codes.** `MetadataService` atomically increments the monthly counters in the `metadata` collection and formats the codes:
   - one shipment code (key `SHIPMENT-<MMYY>`), e.g. `S-0001-1026`;
   - one item code per item (key `ITEM-<MMYY>`, reserved in one step with `nextBusinessCodes()`), e.g. `T-0001-1026`, `T-0002-1026`.
7. **Create the Items** in one `insertMany`. Each Item starts its lifecycle as:
   - `status: CREATED`;
   - `currentLocationId`: the pickup Location, because that is where the item physically is when it is booked;
   - `currentShipmentId`: the new root Shipment. Its ULID is generated before the writes.
8. **Create the Shipment:**
   - It is a root shipment (`parentId: null`) with the default status `CREATED`, the `customerName` and the calculated `cost`.
   - Its `itemIds` are the ULIDs of the Items created in step 7. The `deliveryInfos` reference the resolved Locations by their ULID `id`s.
   - It has two delivery infos: the pickup (`sequence: 1`, `PICKUP`) and the drop-off (`sequence: 2`, `DROPOFF`). Each gets its appointment, an empty `actualWindow`, and status `PENDING`.
9. **Routing** (§5) through suitable cross-docks is a separate service, built later. Nothing is routed at booking. The Items created here are the ones routing and planning will move: each leg (child shipment) references the same Item ULIDs, and no Item is ever created again for a leg.

### 4.3 Cost

`ShipmentCostService` (`backend/src/modules/shipments/shipment-cost.service.ts`) calculates the cost; the client cannot send it.

```
cost = round(baseFee + feePerItem × itemCount + feePerKg × totalWeightKg)
```

- **Configuration:** the three rates come from the environment variables `PRICING_BASE_FEE`, `PRICING_FEE_PER_ITEM` and `PRICING_FEE_PER_KG`. They are not hard-coded, because no business tariff has been agreed.
  - Either all three are set or none. A partial or invalid (negative, non-numeric) set stops the application at startup.
  - With none set, booking answers `503 Service Unavailable`; the other APIs keep working.
  - The values in `backend/.env.example` (20 000 / 5 000 / 3 000) are examples only.
- **Weights:** `LB` is converted with 1 lb = 0.45359237 kg.
- **Currency:** whole VND, rounded to the nearest integer.
- **Deterministic:** the same items and rates always give the same cost.
- **Not considered (yet):** distance, zones, route, `itemUnit`, dimensions or volumetric weight, and appointment times. No such data or rule exists yet.

### 4.4 Failure handling

Booking writes to three collections (`locations`, `items`, `shipments`) and should succeed or fail as a whole. The local MongoDB is a standalone server, which does not support multi-document transactions ("Transaction numbers are only allowed on a replica set member or mongos"). See [`schema-design.md` §10](./schema-design.md#10-decisions-to-confirm). The service therefore uses ordered writes with compensation:

- **Checks first:** the barcode check (step 2) and the cost (step 3) write nothing and run before any write. Most rejected requests therefore change nothing.
- **Shipment last:** the Shipment is the final write. A Shipment that exists is always complete; it never references missing Items.
- **Undo on failure:** if a step from 4 to 8 fails, the service undoes what this booking wrote, then reports the original error:
  - The Items it created are removed. This is a **hard delete**, an explicit exception to soft delete: the Items never belonged to a booked Shipment, and their barcodes must become free again for a retry.
  - Each `STORE` it created is hard-deleted too, unless another shipment or item already references it (a concurrent booking may have reused it).
  - Reused Locations are never touched.
- **Concurrent duplicates:** if another request inserts the same barcode at the same moment, the unique index rejects the insert (duplicate key `11000`). The booking is undone and answered with `409`.
- **Known limitations:**
  - **Gaps in the code sequence:** counter increments are not undone, so a failed booking skips its codes. Codes stay unique.
  - **Not isolated:** between the writes and the undo, other requests can briefly see the new store and Items.
  - **Crash:** if the process stops in the middle of a booking, the undo does not run, and the Items or stores written so far stay behind without a Shipment.
  - **Failed undo:** a failed undo step is logged and does not stop the other undo steps.
  - With a replica set, the same steps could run in one MongoDB transaction, which would remove these limitations.

## 5. Routing (future service)

Routing decides how a Shipment travels from its pickup to its drop-off through one or more suitable `CROSS_DOCK` Locations.

Example: pickup **A** and drop-off **B** are `STORE` Locations; **C1**, **C2**, and **C3** are `CROSS_DOCK` Locations. Possible outcomes are:

- A → C1 → C2 → B
- A → C3 → B

The example shows possible results, not an algorithm. A route is not limited to any fixed number of cross-docks.

**Inputs (agreed):** whether a cross-dock is suitable is decided from postal-code ranges, distances, and relationships between postal codes. That data will be kept in the approved `metadata` collection. None of it exists yet, and none may be invented.

**How legs map to Routes (agreed):**

- Each hop of the journey is a leg, i.e. a child shipment.
- A leg between a `STORE` and a `CROSS_DOCK` (pickup or final delivery) gets **its own Route**.
- A leg between two `CROSS_DOCK`s shares a Route with other shipments: one Route carries many shipments between docks.

Out of scope until the routing task: the algorithm, distance calculation, optimization strategy, and route assignment.

## 6. Location API

Implemented in `backend/src/modules/locations/` (`LocationsController`, `LocationsService`).

| Endpoint | Behavior |
| --- | --- |
| `POST /locations` | Body: `CreateLocationDto`. Returns `201 Created` with the new Location. A `STORE` that matches an existing store (§2) returns `200 OK` with the **existing** Location, unchanged. |
| `GET /locations` | One page of non-deleted Locations (`ListLocationsQueryDto`). Default: sorted by `name` ascending, 20 per page. |
| `GET /locations/:id` | One Location by its public ULID. `404` if unknown or soft-deleted; `400` if `id` is not a ULID. |

Filters of `GET /locations`. All are optional and combined with AND:

| Query parameter | Matches |
| --- | --- |
| `type` | `WAREHOUSE`, `CROSS_DOCK`, `STORE`, `CUSTOMER` |
| `status` | `ACTIVE`, `INACTIVE` |
| `name` | any part of the name, ignoring case (`?name=hanoi` finds "Hanoi Cross-Dock 1") |
| `contactName` | any part of the contact name, ignoring case |
| `postalCode` | the exact postal code, after the same whitespace normalization as the reuse rule (§2) |

Sorting: `sortBy` is `name` (default), `createdAt` or `updatedAt`. Paging and `sortOrder` follow the common list conventions in [`architecture.md`](./architecture.md#lists-filtering-sorting-and-pagination).

- **Response body:** `LocationResponse` (`dto/location-response.dto.ts`), with the public `id` and no `_id`, `__v`, or `deletedAt`. A list returns `LocationPageResponse`: `{ items, page, limit, total }`.
- **Errors:** validation errors, including invalid query parameters, return `400` with Nest's standard `{ statusCode, message: string[], error }` body.
- **For other modules:** `LocationsService.resolveCandidate(candidate)` applies the reuse rule to a `LocationCandidateDto` and returns `{ location, created }`. `LocationsModule` exports the service for the future shipment workflow. It has no HTTP endpoint of its own.
- **Not implemented yet:** update, soft-delete, and authorization (who may create Locations).

## 7. Shipment API

Implemented in `backend/src/modules/shipments/` (`ShipmentsController`, `ShipmentsService`).

| Endpoint | Behavior |
| --- | --- |
| `POST /shipments/book` | Body: `CreateShipmentDto` (§4.1). Runs the booking in §4.2 and returns `201 Created` with the new Shipment. |
| `GET /shipments` | One page of non-deleted Shipments, roots and segments together (`ListShipmentsQueryDto`). Default: newest first (`createdAt` descending), 20 per page. |
| `GET /shipments/:id` | One Shipment by its public ULID. `404` if unknown or soft-deleted; `400` if `id` is not a ULID. |

Filters of `GET /shipments`. All are optional and combined with AND:

| Query parameter | Matches |
| --- | --- |
| `status` | a `ShipmentStatus` |
| `code` | any part of the shipment code, ignoring case (`?code=s-0001`) |
| `customerName` | any part of the customer name, ignoring case |
| `isRoot` | `true`: root shipments (bookings) only; `false`: segments (legs) only |
| `parentId` | the segments of this root shipment (ULID). Combined with `isRoot=true` it is rejected with `400`, because a root has no parent. |
| `itemId` | shipments whose `itemIds` contain this Item (ULID): the booking and every leg of an item |
| `locationId` | shipments with a delivery point (pickup, transit or drop-off) at this Location (ULID) |

Sorting: `sortBy` is `createdAt` (default), `updatedAt`, `code`, `customerName` or `cost`. Segments have no `customerName` or `cost`, so they come first in an ascending sort by those fields.

- **Response body:** `ShipmentResponse` (`dto/shipment-response.dto.ts`). It contains `id`, `code`, `parentId`, `customerName`, `cost`, `itemIds`, `deliveryInfos`, `status`, `metadata`, `createdAt` and `updatedAt`, with no `_id`, `__v`, or `deletedAt`. Locations appear only as ULID `locationId`s; `GET /locations/:id` returns their details. A list returns `ShipmentPageResponse`: `{ items, page, limit, total }`.
- **Errors** (Nest's standard `{ statusCode, message, error }` body):
  - `400`: validation messages (`message: string[]`), including invalid query parameters; the same Location for pickup and drop-off; an `INACTIVE` endpoint Location; `parentId` with `isRoot=true`.
  - `404`: `GET /shipments/:id` for an unknown or soft-deleted Shipment.
  - `409`: an item barcode is already registered, or was taken by a concurrent request.
  - `503`: pricing is not configured (§4.3).
  - `500`: any other failure; the booking is undone (§4.4).
- **Not implemented yet:** updating or cancelling shipments; routing; authorization.
