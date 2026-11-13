# Business Workflows

This document records business processes that span several collections: how Locations enter the system, how they are reused, how a Shipment is created, and where routing fits. Entities, fields, and naming are defined in [`domain-model.md`](./domain-model.md). Open questions are kept in the single list in [`domain-model.md`](./domain-model.md#open-questions).

**Status:**
- The Location API and the Location reuse rule are implemented (§2, §6).
- Shipment booking (shipment, items, cost), routing, child shipments, and route assignment of a routed booking are implemented (§4, §5, §7).
- Listing (filtered, sorted, paginated) and detail lookup of Locations and Shipments are implemented (§6, §7).
- Token login, user management by `SYS_ADMIN`, and the role checks on the writes are implemented (§8).
- Scanning, dock tasks, and the status changes that follow each dock action are specified in [`scanning-flows.md`](./scanning-flows.md) and are not implemented.

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
      "address": { "addressLine1": "1 Dai Co Viet", "city": "Hanoi", "province": "Hanoi", "postalCode": "100000" }
    },
    "appointment": { "from": "2026-10-27T08:00:00+07:00", "to": "2026-10-27T10:00:00+07:00" }
  },
  "dropoff": {
    "location": {
      "name": "Store B",
      "contactName": "Tran Thi B",
      "address": { "addressLine1": "12 Le Loi", "city": "Ho Chi Minh City", "province": "Ho Chi Minh City", "postalCode": "700000" }
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
9. **Route the shipment** (§5) immediately, in the same request, once the root Shipment from step 8 exists. `RoutingService` inserts the cross-dock hubs into that shipment's `deliveryInfos` and saves it. The pickup and the drop-off stay, including the appointments from the request. No Item is created or copied. If routing cannot choose the hubs, the two delivery infos stay as booked, the root stays `CREATED` with `childrenIds: []`, and the response includes `routingStoppedReason`. Routing does not take part in the undo in §4.4.
10. **Create the child shipments** (§5) in the same request, after step 9 has written the hubs. One separate function creates them from the root. It copies `itemIds` and, where the root has an appointment for that end, the appointment. Each child stores `parentId`. The root's `childrenIds` is then set to those children in path order. If step 9 did not route, this step writes nothing. It does not take part in the undo in §4.4.
11. **Assign a route to each child shipment** (§5) in the same request, after step 10. A store–dock leg gets its own route. A dock–dock leg joins that day's morning or evening route for that direction. If step 10 created no children, this step writes nothing. It does not take part in the undo in §4.4. DockTasks are not created here.

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
- **Routing is outside the undo.** Step 9 runs only after the Shipment exists. Choosing no hubs writes nothing. A failure while saving the routed `deliveryInfos` leaves the booked root, its Items, and its stores in place.
- **Child shipments are outside the undo.** Step 10 runs only after routing. If a child insert fails, `childrenIds` stays `[]`. The root, its `deliveryInfos`, its Items, and its stores stay.
- **Route assignment is outside the undo.** Step 11 runs only after the children exist. A failure leaves the booked root and its children in place and does not delete a trunk route other shipments already share.
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

## 5. Routing

Routing runs in the same request as booking, immediately after the root Shipment has been created (§4.2, step 9). `RoutingService` (`backend/src/modules/routing/routing.service.ts`) inserts the cross-dock hubs into that shipment's `deliveryInfos` and saves the shipment. The commercial pickup store **A** and drop-off store **B** stay. Routing does not create child shipments, Routes, or DockTasks, and it does not create or copy Items. Child shipments are the next step in the same request (§4.2, step 10), in `ShipmentsService`, not in `RoutingService`.

Shipments in this project are large freight (boxes, pallets, and the other `itemUnit` values), so each booking goes through one cross-dock in the pickup province and one in the drop-off province. There is no distance or "nearest hub" calculation.

**Reference data already in MongoDB** (read only; booking and routing do not write it):

| Collection | Contents |
| --- | --- |
| `provinces` | 34 provinces and centrally governed cities (level 1). `id` is the province code (`01` is Hà Nội). `name.local`, `name.en`, and `name.slug` are the names used for matching. The read-only model is `Province` in `routing/schemas/province.schema.ts`. |
| `city` | 3321 communes and wards (level 2). Each document's `parent.id` is a `provinces.id`. Routing does not read this collection. |

**Resolving a store to a province.** `address.province` on a Location is free text, and it may be omitted. Routing compares that string, and nothing else, with a province document:

1. Normalize whitespace the same way as the store identity (§2). The comparison is case-insensitive.
2. A match is an exact equality with `name.local`, `name.en`, or the slug without its trailing `-<id>` (`ha-noi-01` is compared as `ha-noi`).
3. Diacritics stay significant, as in §2. `Hanoi` matches `name.en`. `Hà Nội` matches `name.local`. `Ha Noi` matches neither.

This is the happy case: the text entered for the store is one of those three names. No fuzzy match, no postal-code lookup, and no fallback from `address.city` or from `city`. If `address.province` is empty or matches no province, or matches more than one, that end has no province.

**Choosing the hubs.** A' is the cross-dock for A's province and B' is the cross-dock for B's province. A candidate is an `ACTIVE`, non-deleted Location with `type: CROSS_DOCK` whose own `address.province` resolves to that same province document. The province is usable only when that search returns exactly one Location. Zero or several candidates is not a choice the service may guess.

**Path**, written onto the root shipment's `deliveryInfos`. Sequences are `1..n` with no gaps. The pickup keeps the appointment from the request. The drop-off keeps the appointment from the request. A `TRANSIT` point has the hub's `locationId`, status `PENDING`, and an empty `actualWindow`. Its `appointment` is the empty window `{ from: null, to: null }`; routing does not invent a time for the hub.

- Different provinces, both usable: **A (PICKUP) → A' (TRANSIT) → B' (TRANSIT) → B (DROPOFF)**. Sequences 1..4.
- The same province, and that province is usable: **A (PICKUP) → A' (TRANSIT) → B (DROPOFF)**. The hub is inserted once.
- Either end has no province, or a province has no single cross-dock: the original two delivery infos stay unchanged. `POST /shipments/book` still returns `201` with the root Shipment (`CREATED`). The response includes `routingStoppedReason`. Routing writes nothing in this case, and it does not undo the booking, its Items, or its stores.

A failure while saving the updated `deliveryInfos` does not undo the booked root, its Items, or its stores (§4.4).

**Child shipments.** After the hubs are on the root, `ShipmentsService.createChildShipments()` creates one child shipment per hop. A child uses the same shipment shape, but it is not a copy of the root: no `customerName` and no `cost`. It has its own `code` (`S-<nnnn>-MMYY`), `parentId` set to the root, `status: CREATED`, and the root's `itemIds` (the same Item ULIDs, not new Items). `childrenIds` is set only after every insert has succeeded.

Each child has exactly two `deliveryInfos`, `sequence` 1 then 2, status `PENDING`, and an empty `actualWindow`:

| Hop | Ends | `type` of the two points | Appointment |
| --- | --- | --- | --- |
| A → A' | store, then its hub | `PICKUP`, `TRANSIT` | Point 1 copies the root pickup appointment. Point 2 is empty. |
| A' → B' | the two hubs | `TRANSIT`, `TRANSIT` | Both empty. |
| B' → B | the drop-off hub, then the store | `TRANSIT`, `DROPOFF` | Point 1 is empty. Point 2 copies the root drop-off appointment. |

Different provinces produce those three children, in that order. The same province produces two, A → A' and A' → B, and does not create a hop from a hub to itself. `childrenIds` on the root is those ids in the same order. A child does not appear in `childrenIds` without `parentId` pointing back, and a child is not left without being listed.

If routing stopped, no child is created and `childrenIds` stays `[]`. A failure while creating a child does not undo the root, its routed `deliveryInfos`, its Items, or its stores. `currentShipmentId` on each Item stays the root.

**Assigning routes.** After the children exist, `RoutesService.assignForBooking()` attaches each child to a route. A child that is already listed on a non-deleted route is skipped. The root shipment is not itself placed on a route. No DockTask is created.

A route is the trip that will move the items of one or more child shipments from one Location to the next. Scanning later reads the route, not a join back to Item, so each route stores an `items` snapshot taken at assignment. The snapshot fields are `itemId`, `shipmentId` (the child), `itemCode`, `barcode`, `description` when the Item has one, `itemUnit`, `weight`, and `weightUnit`. It does not copy `status` or `currentLocationId`. Those stay on the Item. A scan does not change the snapshot. A booking correction of the Item (§7.2) rewrites `description`, `itemUnit`, `weight` and `weightUnit` in it. `shipmentIds` remains the list of child shipments on the route.

`driverName` and `vehiclePlate` are plain text. Until dispatch exists, every new route uses the fixed placeholders `Nguyen Van Tai` and `29A-000.01`. `createdBy` stays a required ULID. Until users exist, every new route uses the fixed placeholder `01ARZ3NDEKTSV4RRFFQ69G5FAV`. These three constants live in one file. They are not looked up from `users`.

Two kinds of route:

- **Store and dock.** A child whose ends are a `STORE` and a `CROSS_DOCK` (A → A', or B' → B) gets a new route that carries only that child. Its two stops are that child's two `deliveryInfos`. The appointment is the store end's appointment (the pickup appointment on A → A', the drop-off appointment on B' → B). A later direct store-to-store child, if routing could not choose hubs, uses this same dedicated route. That case is not built in this step.
- **Dock and dock.** A child whose ends are both `CROSS_DOCK` (A' → B') joins one shared route per direction, per Vietnam calendar day, per slot. The opposite direction is a different route. The key is the origin dock, the destination dock, `serviceDate` (`YYYY-MM-DD` in Vietnam time, UTC+7), and `slot`. `MORNING` has appointment 08:00–12:00 that day. `EVENING` has 18:00–22:00. A booking placed before 12:00 uses that day's morning route. A booking placed from 12:00 uses that day's evening route. The service looks for a non-deleted route with that key and status `PLANNED`. If it finds one, it appends the child to `shipmentIds`, to both stops' `shipmentIds`, and appends the item snapshots. If that route exists but is no longer `PLANNED`, the child goes to the next slot (the evening of the same day, or the morning of the next day). If none exists, the service creates it. Both stops are `TRANSIT`. A unique index on `fromLocationId` + `toLocationId` + `serviceDate` + `slot`, only where `slot` is set and `deletedAt` is null, stops two requests from creating the same trunk route. Those four fields equal the two stop locations, the day, and the slot.

A failure while assigning one child does not remove the children or the trunk routes already shared with other bookings. `currentShipmentId` stays the root. No DockTask is created by booking or by route assignment. The first tasks are created when a dock action runs ([`scanning-flows.md`](./scanning-flows.md)).

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
- **Who may call it:** `POST /locations` needs a `SYS_ADMIN` token: `401` without a valid one, `403` for another role ([`domain-model.md` §4.2](./domain-model.md#42-user)). The two `GET`s are public.
- **Not implemented yet:** update and soft-delete.

## 7. Shipment API

Implemented in `backend/src/modules/shipments/` (`ShipmentsController`, `ShipmentsService` for booking and reading, `ShipmentEditsService` for the corrections in §7.2).

| Endpoint | Behavior |
| --- | --- |
| `POST /shipments/book` | Body: `CreateShipmentDto` (§4.1). Runs the booking in §4.2, then routing and route assignment (§5), and returns `201 Created`. |
| `GET /shipments` | One page of non-deleted Shipments as summary rows (`ListShipmentsQueryDto`). Without `isRoot` it returns roots and segments together. The shipments screen always sends `isRoot=true`, so it lists bookings only. Default: newest first (`createdAt` descending), 20 per page. |
| `GET /shipments/:id/view` | A booking with everything its detail screen shows (§7.1). Root shipments only. |
| `GET /shipments/:id` | One Shipment by its public ULID. `404` if unknown or soft-deleted; `400` if `id` is not a ULID. |
| `PUT /shipments/:id` | Corrects the customer name of a booking (§7.2). |
| `PUT /shipments/:id/appointments` | Replaces the pickup and drop-off appointments of a booking (§7.2). |
| `PUT /shipments/:id/items/:itemId` | Corrects one Item of a booking (§7.2). |

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

- **Response body:** `ShipmentResponse` (`dto/shipment-response.dto.ts`) for `GET /shipments/:id` and `PUT /shipments/:id`. It contains `id`, `code`, `parentId`, `childrenIds`, `customerName`, `cost`, `itemIds`, `deliveryInfos`, `status`, `metadata`, `createdAt` and `updatedAt`, with no `_id`, `__v`, or `deletedAt`. `childrenIds` lists the child shipments in path order and is `[]` until they exist. Locations appear only as ULID `locationId`s; `GET /locations/:id` returns their details. `POST /shipments/book` returns `BookShipmentResponse`, which adds `routingStoppedReason` when routing left the two delivery infos unchanged (§5). That field is not stored and is not part of a list or detail response.
- **List rows:** a list returns `ShipmentPageResponse` (`dto/shipment-summary-response.dto.ts`): `{ items, page, limit, total }`, where each item is a `ShipmentSummaryResponse`. A row has `id`, `code`, `status`, `customerName`, `cost`, `createdAt`, and:
  - `origin` and `destination`: `{ id, name, type, province }` of the `PICKUP` and `DROPOFF` Locations. A leg has at most one of them, so the other is `null`. A Location that is not found keeps its `id`, and the other three fields are `null`.
  - `pickupAppointment` and `dropoffAppointment`: the appointments of those two points.
  - `items`: `{ id, itemCode, itemUnit, weight, weightUnit }` in `itemIds` order. An Item that is not found is left out.
  - `routed`: `true` when the path has at least one `TRANSIT` point.

  After the page query, `findSummaryPage()` runs two more queries for the whole page: one `find({ id: { $in } })` on `locations` and one on `items`, each selecting only the fields above. It never runs one query per row.
- **Errors** (Nest's standard `{ statusCode, message, error }` body):
  - `400`: validation messages (`message: string[]`), including invalid query parameters and an `:id` or `:itemId` that is not a ULID; the same Location for pickup and drop-off; an `INACTIVE` endpoint Location; `parentId` with `isRoot=true`; appointment windows in the wrong order (§7.2).
  - `404`: an unknown or soft-deleted Shipment. `/view` and the three `PUT`s also return `404` for a segment id, because they accept bookings only. An `itemId` that is not in the booking's `itemIds` is `404` too.
  - `409`: an item barcode is already registered, or was taken by a concurrent request; a `PUT` on a booking whose status is not `CREATED`.
  - `503`: pricing is not configured (§4.3), for booking and for `PUT /shipments/:id/items/:itemId`.
  - `500`: any other failure. A failure in steps 4 to 8 undoes the booking (§4.4). A failure while saving routed `deliveryInfos` does not.
- **Who may call it:** `POST /shipments/book` and the three `PUT`s need a `SYS_ADMIN` or `ADMIN` token: `401` without a valid one, `403` for another role ([`domain-model.md` §4.2](./domain-model.md#42-user)). The `GET`s are public.
- **Not implemented yet:** cancelling shipments, changing the items of a booking (adding or removing one), and changing a route's driver or vehicle. DockTasks are not created by booking. A route's `createdBy` is still the placeholder ULID, not the caller.

### 7.1 Booking view

`GET /shipments/:id/view` returns `ShipmentViewResponse` (`dto/shipment-view-response.dto.ts`), the data of the booking detail screen in one response:

| Field | Contents |
| --- | --- |
| `shipment` | the root, as `ShipmentResponse` |
| `locations` | every Location on the root's and the children's `deliveryInfos`, as `LocationResponse` |
| `items` | the root's Items in `itemIds` order, as `ItemResponse` (`items/dto/item-response.dto.ts`) |
| `children` | the child shipments in `childrenIds` order, as `ShipmentResponse` |
| `routes` | the non-deleted routes that carry any child, as `RouteResponse` (`routes/dto/route-response.dto.ts`): `routeNumber`, `status`, `driverName`, `vehiclePlate`, `serviceDate` and `slot` (dock–dock routes only), `appointment`, `fromLocationId`, `toLocationId`, `shipmentIds`, `stops`, and `items`. The items are only `itemId`, `shipmentId`, `itemCode` and `barcode` from the route snapshot. |

It uses five indexed queries and no `populate` or `$lookup`: the root by `id` (with `parentId: null`), then the children by `parentId`, the Items by `id`, and the routes by `shipmentIds` together, then the Locations by `id`. A segment id or an unknown id is `404`. The route is declared before `GET /shipments/:id`.

### 7.2 Correcting a booking

A booking can be corrected only while it is `CREATED`. All three `PUT`s:

- accept a root id only. A segment id is `404`.
- return `409` with "… the booking can no longer be edited" when the booking is not `CREATED`. The root is written with a filter that includes `status: CREATED`, so a status change between the read and the write is also `409`.
- write with `runValidators: true`.

| Endpoint | Body | Writes | Returns |
| --- | --- | --- | --- |
| `PUT /shipments/:id` | `UpdateShipmentCustomerDto`: `{ customerName }` | `customerName` on the root | `ShipmentResponse` |
| `PUT /shipments/:id/appointments` | `UpdateAppointmentsDto`: `{ pickup, dropoff }`, two `{ from, to }` windows | see below | `ShipmentViewResponse` |
| `PUT /shipments/:id/items/:itemId` | `UpdateItemDto`: any of `description` (string, or `null` to remove it), `itemUnit`, `weight` (positive), `weightUnit`, `dimensions` | see below | `ShipmentViewResponse` |

**Appointments.** Each window needs `from` before `to`, and `pickup.to` must not be later than `dropoff.from`. Otherwise the request is `400` and nothing is read or written. Both windows are always sent and written:

1. The root's `PICKUP` and `DROPOFF` appointments.
2. The child that starts at the pickup store: its point 1. The child that ends at the drop-off store: its point 2.
3. The dedicated route (a route without `slot`, §5) of each of those two children: the route `appointment` and the appointment of its stop at the store.

The dock–dock route keeps its slot appointment. `actualWindow` and point statuses are not changed. An unrouted booking has no children or routes, so only the root is written.

**Item.** `itemId` must be in the booking's `itemIds`. `weightUnit` is required when `weight` is sent. `barcode`, `itemCode`, `status`, `currentLocationId` and `currentShipmentId` are not in the DTO, so sending them is `400`. In this order:

1. `ShipmentCostService` recalculates the booking cost (§4.3) with the new weight. When pricing is not configured this is `503` and nothing is written.
2. The Item is updated.
3. The root's `cost` is set to the new cost.
4. On every non-deleted route that carries a child of this booking, the item's snapshot row gets the new `description`, `itemUnit`, `weight` and `weightUnit`. `itemCode` and `barcode` never change.

The writes are not in a transaction (the local MongoDB is standalone). A failure part-way leaves the earlier writes in place, and the same `PUT` can be sent again.

No other `PUT` exists. Items are not added to or removed from a booking.

## 8. Auth and User API

Implemented in `backend/src/modules/auth/` (`AuthController`, `AuthService`, `AuthGuard`) and `backend/src/modules/users/` (`UsersController`, `UsersService`). Roles, login rules, and who may call which endpoint are in [`domain-model.md` §4.2](./domain-model.md#42-user).

| Endpoint | Behavior |
| --- | --- |
| `POST /auth/login` | Body: `LoginDto` `{ email, password }`. Returns `200` with `LoginResponse`: `{ accessToken, tokenType: 'Bearer', expiresIn: 28800, user }`, and sets `lastLoginAt`. Any failure is `401` "Invalid email or password." Public. |
| `POST /users` | Body: `CreateUserDto`: `fullName`, `email`, `password` (at least 8 characters), `roles` (at least one, no duplicates). The user is `ACTIVE`. Returns `201`. |
| `GET /users` | One page of non-deleted users (`ListUsersQueryDto`). Filters: `email` (any part, ignoring case) and `status`. Default: `fullName` ascending, 20 per page. |
| `GET /users/:id` | One user. `404` if unknown or soft-deleted; `400` if `id` is not a ULID. |
| `PUT /users/:id` | Body: `UpdateUserDto`. Any of `fullName`, `email`, `roles`, `status`, `password`; only the fields sent change. `roles` replaces all roles and must not be empty. |

- **Who may call it:** the four `/users` endpoints need a `SYS_ADMIN` token: `401` without a valid one, `403` for another role. There is no registration endpoint.
- **Response body:** `UserResponse` (`users/dto/user-response.dto.ts`): `id`, `fullName`, `email`, `roles`, `status`, `lastLoginAt`, `createdAt`, `updatedAt`. There is no `passwordHash`, `_id`, `__v` or `deletedAt`. A list returns `UserPageResponse`: `{ items, page, limit, total }`.
- **Passwords** are hashed with `bcryptjs` before they are stored as `passwordHash`, on create and on a `PUT` that sends `password`.
- **Errors:**
  - `400`: validation messages; on your own user, a `status` of `LOCKED` or `INACTIVE` ("You cannot set your own status to …") or `roles` without `SYS_ADMIN` ("You cannot remove SYS_ADMIN from your own roles.").
  - `404`: an unknown or soft-deleted user.
  - `409`: the email already belongs to a user, in any case, including a soft-deleted one.
- **First user:** with an empty database nobody can log in. On startup, `UsersService` creates the first `SYS_ADMIN` from `AUTH_SEED_EMAIL`, `AUTH_SEED_PASSWORD` and `AUTH_SEED_NAME` ([`architecture.md` §6](./architecture.md#6-configuration-and-local-infrastructure)).
- **Not implemented yet:** soft-deleting a user. The frontend login screen is described in [`architecture.md` §9](./architecture.md#9-frontend).
