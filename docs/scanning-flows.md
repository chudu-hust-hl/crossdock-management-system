# Scanning flows

This document is the source of truth for dock scanning and for the status changes that follow each dock action. Collections, field names, and status enums are defined in [`domain-model.md`](./domain-model.md). How a booking creates items, child shipments, and routes is defined in [`business-workflows.md`](./business-workflows.md). This flow is implemented in the backend `dock-tasks` module: the five endpoints, the RabbitMQ topology, and the status rollup (§11). The dock desk, where a person works one cross-dock, is specified in §12. Its screens are built. Scanning from the work page is not. Scanning stays off the route page.

Read this file before adding a scan API, a dock screen, a DockTask write, or a RabbitMQ client. Do not invent a second status machine. If a change here conflicts with `domain-model.md`, stop and ask; do not edit the domain model silently.

## 1. What a scan is

A scan records one physical fact about one item at one location: the item arrived, the item left, or the item is missing. The HTTP request stores that fact. A queue then updates the route and the shipments from the stored facts.

Two kinds of route already exist:

| Route | Ends | How many shipments |
| --- | --- | --- |
| Store–dock | A store and one cross-dock | One child shipment |
| Dock–dock | Two cross-docks, one direction, one Vietnam day, one `MORNING` or `EVENING` slot | Many child shipments |

A child shipment is a leg. The root shipment is the booking. The root is never placed on a route. A path through two provinces is three legs:

1. **A → A'.** Store to the pickup dock. Its own route.
2. **A' → B'.** Dock to dock. The shared route.
3. **B' → B.** Dock to the drop-off store. Its own route.

The same province has two legs, A → A' and A' → B, and no dock–dock route. Every rule below still applies: there is simply no middle route.

No DockTask is created by booking or by route assignment. The first tasks appear when the actions in §4 run.

## 2. Words

| Word | Means |
| --- | --- |
| Leg | A child shipment. `parentId` points at the root. |
| Stop | One embedded stop on a route. A route in this flow has two stops. There is no RouteStop collection. |
| Expected item | An item whose child shipment is in the route's `shipmentIds`, and whose status is not `EXCEPTION`. |
| Handled | The item has a `COMPLETED` DockTask for the action this stop is waiting for. |
| Last known location | `Item.currentLocationId`. It changes when a scan or a manual delivery confirms the item is there. While the item is `IN_TRANSIT` it still shows the place it left. |

Status values already in the schemas:

| Entity | Values this flow uses |
| --- | --- |
| Item | `CREATED`, `IN_TRANSIT`, `AT_DOCK`, `DELIVERED`, `EXCEPTION` |
| Shipment (root and leg) | `CREATED`, `IN_TRANSIT`, `AT_DOCK`, `DELIVERED`, `EXCEPTION` |
| Route | `PLANNED`, `IN_PROGRESS`, `COMPLETED` |
| Route stop and delivery point | `PENDING`, `PROCESSING`, `COMPLETED` |
| DockTask | `PENDING`, `COMPLETED` |

`CANCELLED`, `FAILED`, `SKIPPED`, `ARRIVED`, `PHOTO`, and `INSPECTION` are not used here. A photo taken as part of a scan is stored on the scan task. It is not a second task.

`currentShipmentId` is the shipment that currently accounts for the item:

- `IN_TRANSIT`: the leg that is carrying it. That leg's `itemIds` contains the item.
- `CREATED`, `AT_DOCK`, `DELIVERED`, `EXCEPTION`: the root shipment.

The route snapshot (`items` on the route) is a copy made at assignment. A scan does not change it. `driverName` and `vehiclePlate` stay the fixed placeholders.

`performedBy` on every task a dock action completes is the id of the logged-in caller, taken from the token ([`domain-model.md` §4.2](./domain-model.md#42-user)). A `PENDING` task has no `performedBy` until someone completes it. Booking still writes the placeholder ULID `01ARZ3NDEKTSV4RRFFQ69G5FAV` on a route's `createdBy`; the dock actions do not change it.

## 3. What the request writes, and what the queue writes

MongoDB in this project is a standalone server. A request cannot commit the item, the task, the route, and both shipments in one transaction. The split is therefore fixed.

**The request writes the physical fact, then publishes one message.**

1. Save the proof of the action: one `COMPLETED` DockTask per item this action handled, and the next `PENDING` DockTask when §5 says one is created.
2. Update each of those items (`status`, `currentLocationId`, `currentShipmentId`).
3. Publish one message (§8). The message carries ids only.
4. Return success to the caller.

The caller may refresh the item and the task list immediately. The route and the shipments may still show the previous status until the consumer runs.

**The consumer writes the operational rollup, and nothing else.**

It loads the tasks and the items by the ids in the message, then updates, in this order:

1. The two stops of the route.
2. The route status and `actualWindow`.
3. The leg's status and that leg's two `deliveryInfos`.
4. The root's status and the root's `deliveryInfos` point for this hop.

It does not create DockTasks, does not move an item, and does not change a route snapshot. Publishing a second event from the consumer is not part of this design. One message, one consumer.

If the process stops after the item is saved and before the publish, the item and the task stay. §8 explains how that message is sent again. The rollup is safe to run twice: it only moves a status forward, and it recomputes from the tasks already stored.

## 4. The four actions

Each action is one API call. Barcodes are read from a pending task at a chosen location and route. A barcode that has no `PENDING` task there is rejected. The screen fills `itemCode`, description, weight, and the leg from that task and from the route snapshot. The scan does not create an Item.

A scan submit requires one photo. The file is stored on local disk first. The task's `metadata.podPath` is the path of that file. Manual pickup and manual delivery do not require a photo.

### 4.1 Confirm pickup at the store

The operator confirms that the truck has taken the goods of one store–dock route. There is no barcode scan at the store.

The request, for every expected item on that route:

| Write | Value |
| --- | --- |
| New DockTask | `type: SCAN_OUTBOUND`, `status: COMPLETED`, `locationId` the store, `routeId` this route, `shipmentId` and `outboundLegId` the leg A → A', `metadata.reason: MANUAL_PICKUP`, `completedAt` now |
| Item | `status: IN_TRANSIT`, `currentShipmentId` the leg, `currentLocationId` unchanged (still the store) |
| Next DockTask | `type: SCAN_INBOUND`, `status: PENDING`, `locationId` the dock A', `routeId` this same route, `shipmentId` and `inboundLegId` the leg A → A' |

One message, routing key `route.pickup.confirmed`.

The consumer then sets:

| Target | Result |
| --- | --- |
| Stop 1 (store) | `COMPLETED`. `actualWindow.from` and `actualWindow.to` are now if they were empty. |
| Stop 2 (dock) | Stays `PENDING`. |
| Route | `IN_PROGRESS`. `actualWindow.from` is now if it was empty. |
| Leg A → A' | `IN_TRANSIT`. Its point 1 (`PICKUP`) is `COMPLETED` with the same actual window. |
| Root | `IN_TRANSIT`, unless some item is already `EXCEPTION` (§6). The root's `PICKUP` point is `COMPLETED`. |

A route that is not `PLANNED` cannot be picked up again.

### 4.2 Scan in at a dock

The operator chooses the dock and the route that arrives there, scans a barcode, checks the filled-in item, takes the photo, and submits.

The barcode must match a `PENDING` `SCAN_INBOUND` task with this `locationId` and this `routeId`. The request completes that task (`status: COMPLETED`, `completedAt`, `metadata.podPath`) and updates the item:

| Field | Value |
| --- | --- |
| `status` | `AT_DOCK` |
| `currentLocationId` | This dock |
| `currentShipmentId` | The root shipment |

It then creates the next `PENDING` task (§5). One message, routing key `dock.scan.completed`, with `type: SCAN_INBOUND`.

The consumer recomputes the **destination stop** of this route (the stop whose `locationId` is the dock):

| How many expected items are handled | Stop | Route | Leg of this item | Root point |
| --- | --- | --- | --- | --- |
| At least one, and at least one still has a `PENDING` scan-in | `PROCESSING`. `actualWindow.from` is now if it was empty. | Stays `IN_PROGRESS`. | Stays as it was, unless every non-exception item of that leg is now `AT_DOCK` at this dock. Then the leg is `AT_DOCK` and its destination point is `COMPLETED`. | The matching `TRANSIT` point becomes `PROCESSING`. |
| Every expected item has a `COMPLETED` scan-in | `COMPLETED`. `actualWindow.to` is now. | `COMPLETED`. `actualWindow.to` is now. | `AT_DOCK`. Its destination point is `COMPLETED`. | The matching `TRANSIT` point is `COMPLETED`. |

"Handled" for this stop means a `COMPLETED` `SCAN_INBOUND` at this dock on this route. An item already `EXCEPTION` is not expected, so it does not keep the stop open.

On a store–dock route this stop is the dock, and completing it finishes that route. On a dock–dock route this stop is dock B', and completing it finishes the shared route. One item finishing its own scan does not finish the route while another shipment on that route still has a pending scan-in.

### 4.3 Scan out at a dock

The operator chooses the dock and the route that leaves it. The screen lists every `PENDING` `SCAN_OUTBOUND` task for that pair. Those tasks were created when each item was scanned in (§5). The operator scans each barcode and takes a photo per item.

The barcode must match one of those pending tasks. The request completes it, stores `metadata.podPath`, and sets the item to `IN_TRANSIT` with `currentShipmentId` equal to the outbound leg. `currentLocationId` stays this dock until a later scan-in or delivery confirms the next place.

The first successful scan-out on a route that is still `PLANNED` is what takes the route out of `PLANNED`. The consumer sets the route to `IN_PROGRESS`. A route that is not `PLANNED` does not accept another booking ([`business-workflows.md` §5](./business-workflows.md#5-routing)), so a truck that has started loading does not gain new shipments.

The truck may leave only when every expected item on the route has been handled at this dock. Handled here means either a `COMPLETED` `SCAN_OUTBOUND` or a `COMPLETED` `EXCEPTION` task with `errorCode: MISSING` (§4.4). An item that is on the route but has no outbound task yet (it was never scanned in) is still expected. It blocks departure until it is scanned out or marked missing. The screen shows those items as not ready. There is no automatic move onto the next morning or evening route.

| How many expected items are handled | Origin stop | Route | Legs that have at least one item now `IN_TRANSIT` |
| --- | --- | --- | --- |
| Some, not all | `PROCESSING` | `IN_PROGRESS` | Each such leg is `IN_TRANSIT`. Its origin point is `PROCESSING`. |
| All | `COMPLETED`, `actualWindow.to` now | Stays `IN_PROGRESS`. The route finishes at the destination, not at departure. | Those legs are `IN_TRANSIT`. Their origin points are `COMPLETED`. |

The destination stop stays `PENDING` until the first scan-in there. The root's point for the dock just left is `COMPLETED` only when every non-exception item of the booking has left it. The message routing key is `dock.scan.completed` with `type: SCAN_OUTBOUND`.

The last dock uses the same scan-out. The route is the dedicated dock–store route. Leaving the dock does not deliver the goods. The store is confirmed by §4.5.

### 4.4 Mark an item missing

The operator marks one expected item missing so the rest of the route can leave. This is allowed whether or not the item was scanned in.

The request writes:

| Write | Value |
| --- | --- |
| The open `SCAN_INBOUND` or `SCAN_OUTBOUND` task for this item, route, and location, if one exists | `COMPLETED`, `completedAt` now. This closes the work item so it no longer blocks the stop. |
| New DockTask | `type: EXCEPTION`, `status: COMPLETED`, `errorCode: MISSING`, `errorMessage` a short operator note, same `itemId`, `routeId`, `locationId`, and the leg ids of the task it closed. `metadata.reason: MISSING`. |
| Item | `status: EXCEPTION`. `currentLocationId` and `currentShipmentId` are left as they are. The item stays where it was last confirmed. |

No next task is created. The item is no longer expected on this route or on any later leg. One message, routing key `dock.item.missing`.

The consumer runs the same stop rule as scan-out or scan-in, depending on which stop was blocked. The other items continue. The leg's own status follows §6, so one missing item does not freeze the items that already left. The root becomes `EXCEPTION`.

A `COMPLETED` task is never edited afterwards. Marking missing creates the `EXCEPTION` row; it does not rewrite a scan that already happened.

### 4.5 Confirm delivery at the store

The operator confirms that the goods of one dock–store route were handed over at store B. There is no barcode scan at the store. Every expected item on that route must already be `IN_TRANSIT` on the last leg (they were scanned out of the last dock). Otherwise the call is rejected.

The request, for every expected item:

| Write | Value |
| --- | --- |
| New DockTask | `type: SCAN_INBOUND`, `status: COMPLETED`, `locationId` store B, `routeId` this route, `shipmentId` and `inboundLegId` the last leg, `metadata.reason: MANUAL_DELIVERY`, `completedAt` now |
| Item | `status: DELIVERED`, `currentLocationId` store B, `currentShipmentId` the root |

No next task. One message, routing key `route.delivery.confirmed`.

The consumer sets the destination stop and the route to `COMPLETED`, the last leg to `DELIVERED`, and that leg's `DROPOFF` point to `COMPLETED`. The root's `DROPOFF` point is `COMPLETED`. The root itself is `DELIVERED` only when no item of the booking is `EXCEPTION` (§6).

## 5. When the next task is created

The request that completes an action creates the next `PENDING` task before it publishes. The consumer never creates tasks. Creating the task in the request means the dock screen can show the next job even if the queue is down.

| Action that just finished | Next `PENDING` task | `routeId` | `locationId` | Leg fields |
| --- | --- | --- | --- | --- |
| Pickup at store A | `SCAN_INBOUND` | The store–dock route | Dock A' | `shipmentId` and `inboundLegId` = leg A → A' |
| Scan in at dock A', and a later leg exists | `SCAN_OUTBOUND` | The route of the next leg (the shared dock–dock route, or the dock–store route when there is no middle leg) | Dock A', the dock the item is in | `shipmentId` and `outboundLegId` = that next leg |
| Scan out at dock A' toward dock B' | `SCAN_INBOUND` | The same dock–dock route | Dock B' | `shipmentId` and `inboundLegId` = leg A' → B' |
| Scan in at dock B' | `SCAN_OUTBOUND` | The dock–store route | Dock B' | `shipmentId` and `outboundLegId` = leg B' → B |
| Scan out at dock B' toward store B | None. The store is confirmed manually. | | | |
| Mark missing | None | | | |
| Confirm delivery | None | | | |

A task is inserted only if the item does not already have a non-deleted `PENDING` task with the same `type`, `routeId`, and `locationId`. A retried request must not create a second one.

`shipmentId` on a DockTask is the leg this task is about, and that leg is one of the route's `shipmentIds`. `SCAN_INBOUND` always has `inboundLegId` set to that leg and `outboundLegId` null. `SCAN_OUTBOUND` always has `outboundLegId` set and `inboundLegId` null. `EXCEPTION` copies the leg ids of the task it closed.

## 6. How a leg and the root get their status

The consumer sets a leg from that leg's own items. Items in `EXCEPTION` are left out of the "all items" checks. They do not hold the other items back.

| Condition | Leg status |
| --- | --- |
| Every item of the leg is `EXCEPTION` | `EXCEPTION` |
| Every item that is not `EXCEPTION` is `DELIVERED` | `DELIVERED` |
| Every item that is not `EXCEPTION` is `AT_DOCK` at this leg's destination | `AT_DOCK` |
| Any item that is not `EXCEPTION` is `IN_TRANSIT` on this leg | `IN_TRANSIT` |
| Otherwise | `CREATED` |

The root is one status for the whole booking:

| Condition, first match wins | Root status |
| --- | --- |
| Any item is `EXCEPTION` | `EXCEPTION` |
| The last leg is `DELIVERED` | `DELIVERED` |
| Any leg is `IN_TRANSIT` | `IN_TRANSIT` |
| Any leg is `AT_DOCK` | `AT_DOCK` |
| Otherwise | `CREATED` |

A booking can therefore be `EXCEPTION` while some of its items are still moving or already `DELIVERED`. The item rows are what show which packages continued. The root status is the signal that the booking needs attention.

Delivery points on the root follow the same hops. A point becomes `PROCESSING` when its leg has started that hop and `COMPLETED` when the leg has finished it. `actualWindow.from` is set the first time the point leaves `PENDING`. `actualWindow.to` is set when the point becomes `COMPLETED`. Points of later hops stay `PENDING`.

Statuses do not move backwards. A second run of the same message writes the same values.

## 7. Worked example

One booking, two boxes, different provinces. Both boxes stay together until box 2 is marked missing at dock A'.

| Step | Box 1 | Box 2 | Route of this step | Leg of this step | Root |
| --- | --- | --- | --- | --- | --- |
| Booked | `CREATED` at store A | `CREATED` at store A | All three `PLANNED` | All `CREATED` | `CREATED` |
| Confirm pickup | `IN_TRANSIT` on leg 1 | `IN_TRANSIT` on leg 1 | Store–dock `IN_PROGRESS`, store stop `COMPLETED` | Leg 1 `IN_TRANSIT` | `IN_TRANSIT` |
| Scan in box 1 at A' | `AT_DOCK` at A' | still `IN_TRANSIT` | Destination stop `PROCESSING` | Leg 1 stays `IN_TRANSIT` | `IN_TRANSIT` |
| Scan in box 2 at A' | `AT_DOCK` at A' | `AT_DOCK` at A' | Store–dock `COMPLETED` | Leg 1 `AT_DOCK` | `AT_DOCK` |
| Scan out box 1 at A' | `IN_TRANSIT` on leg 2 | `AT_DOCK` at A', outbound task still `PENDING` | Shared route `IN_PROGRESS`, origin stop `PROCESSING`. No new booking can join. | Leg 2 `IN_TRANSIT` | `IN_TRANSIT` |
| Mark box 2 missing | unchanged | `EXCEPTION`, still last seen at A' | Origin stop `COMPLETED` because every expected item is now handled. Box 2 is no longer expected. | Leg 2 stays `IN_TRANSIT` | `EXCEPTION` |
| Scan in box 1 at B' | `AT_DOCK` at B' | `EXCEPTION` | Shared route `COMPLETED` | Leg 2 `AT_DOCK` | `EXCEPTION` |
| Scan out box 1 at B' | `IN_TRANSIT` on leg 3 | `EXCEPTION` | Dock–store route `IN_PROGRESS` | Leg 3 `IN_TRANSIT` | `EXCEPTION` |
| Confirm delivery | `DELIVERED` at store B | `EXCEPTION` | Dock–store route `COMPLETED` | Leg 3 `DELIVERED` | `EXCEPTION` |

If box 2 had also been delivered, the root at the last row would be `DELIVERED`.

## 8. RabbitMQ

One exchange, two queues. All four actions publish to the same exchange. All four are consumed by the same rollup queue, so there is one place that updates routes and shipments.

| Name | Kind | Durable | What it does |
| --- | --- | --- | --- |
| `crossdock.events` | topic exchange | yes | Receives every dock event. The request publishes here. No consumer binds to the exchange directly. |
| `crossdock.rollup` | queue | yes | Bound to the four routing keys below. One consumer, prefetch 1. Recomputes stop, route, leg, and root as in §3–§6. Acks only after those writes succeed. |
| `crossdock.dlx` | direct exchange | yes | Dead-letter exchange of `crossdock.rollup`. |
| `crossdock.rollup.dlq` | queue | yes | Bound to `crossdock.dlx` with routing key `crossdock.rollup.failed`. No consumer. A person inspects messages that failed 3 times. |

Bindings of `crossdock.rollup`:

| Routing key | Published when | Consumer action |
| --- | --- | --- |
| `route.pickup.confirmed` | Pickup at the store was stored (§4.1) | Complete the store stop, set the route and the leg `IN_TRANSIT`, complete the root `PICKUP` point |
| `dock.scan.completed` | A scan-in or a scan-out was stored (§4.2, §4.3) | Apply the stop table for that scan type. The message's `type` says which. |
| `dock.item.missing` | An item was marked missing (§4.4) | Recompute the blocked stop without that item, and set the root to `EXCEPTION` |
| `route.delivery.confirmed` | Delivery at the store was stored (§4.5) | Complete the store stop, the route, the last leg, and the root `DROPOFF` point |

Message body, JSON, ids only:

```json
{
  "eventId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "occurredAt": "2026-11-13T07:30:00.000Z",
  "type": "SCAN_INBOUND",
  "routeId": "01M4GVJ9TMCR0DTRTXG3JHTPHS",
  "locationId": "01M4GVJ9TMCR0DTRTXG3JHTPHT",
  "itemIds": ["01M4GVJ9TMCR0DTRTXG3JHTPHV"],
  "taskIds": ["01M4GVJ9TMCR0DTRTXG3JHTPHW"]
}
```

The ids above are examples of the shape only.

`type` is `SCAN_INBOUND`, `SCAN_OUTBOUND`, `MANUAL_PICKUP`, `MANUAL_DELIVERY`, or `MISSING`. `eventId` is a new ULID for the log line. It is not stored in a collection. The consumer does not need it to be idempotent, because it recomputes from `taskIds` and the current documents.

Retry: the consumer handles a failure by publishing the same body again with a header `x-retry` increased by 1. After the third failure it publishes the body to `crossdock.dlx` with routing key `crossdock.rollup.failed` and acks the original message. It does not requeue the original message forever.

Replay: a single function `republishPendingRollups()` publishes again, to the same routing keys, for facts the consumer has not caught up with. It does not have its own queue. A fact needs a replay when:

- an item is `IN_TRANSIT` on a leg whose route is still `PLANNED` (pickup or scan-out was stored, rollup did not run), or
- an item is `AT_DOCK` at a route's destination while that destination stop is still `PENDING`, or
- an item is `DELIVERED` while its dock–store route is not `COMPLETED`, or
- an item is `EXCEPTION` with a `MISSING` task while the root is not `EXCEPTION`.

The connection string comes from `RABBITMQ_URL`. There is no default that hides a missing variable: if the variable is absent (or the broker cannot be reached at startup), the process starts and the dock actions answer `503` with a message that names `RABBITMQ_URL`, before they write anything. Booking, login, and the read APIs do not need the broker and never connect to it.

The broker is part of local infrastructure: RabbitMQ on `127.0.0.1:5673`, management UI at `http://localhost:15673` (guest / guest). `RABBITMQ_URL` is `amqp://guest:guest@localhost:5673`. When the variable is set, the API connects at startup and declares the exchanges `crossdock.events` and `crossdock.dlx`, the queues `crossdock.rollup` (dead-letter exchange `crossdock.dlx`, dead-letter routing key `crossdock.rollup.failed`) and `crossdock.rollup.dlq`, and the bindings above, all durable. `RabbitMqService` is the only place that declares them.

## 9. What this flow does not do

- It does not scan at the store. Pickup and delivery are the two manual confirmations.
- It does not create tasks at booking time.
- It does not move a missed item onto the next slot by itself.
- It does not change `driverName`, `vehiclePlate`, or the route snapshot.
- It does not accept an anonymous caller. Every dock action requires a token with a dock role, and `performedBy` is the caller's id. Only a route's `createdBy`, written at booking, is still the placeholder ULID.
- It does not store the photo in an object store. `metadata.podPath` is a local path.
- It does not add a collection for events, photos, or queues.
- It does not add a consumer per status. Route and shipment updates stay in `crossdock.rollup`.

## 10. Notes for an implementing agent

- Put the four actions in the dock-tasks module. Put the publisher and `republishPendingRollups()` next to them. Put the rollup function in one service that the consumer calls. Do not add a generic event bus, a repository layer, or a task factory.
- The HTTP handlers return after the item and the tasks are saved and the publish has been attempted. They do not update the route or the shipment documents.
- Reject a scan whose barcode is not a `PENDING` task for the selected `locationId` and `routeId`.
- Reject confirm-pickup unless the route is `PLANNED` and is a store–dock route. Reject confirm-delivery unless every expected item of that dock–store route is `IN_TRANSIT` on the last leg.
- Keep Swagger on the new endpoints, and add the consumer tests around the tables in §4 and §6: one item does not complete a shared route; a missing item lets the other items leave; the root becomes `EXCEPTION`; a second delivery of the same message does not create a second task or move a status backwards.
- Update this file if an implementation has to deviate from it.

## 11. Implementation

The backend `dock-tasks` module implements this flow. Each endpoint requires a token (`401` without a valid one) and one of the roles below (`403` otherwise).

| Endpoint | Roles | Body | Message |
| --- | --- | --- | --- |
| `POST /dock-tasks/pickup` | `SYS_ADMIN`, `DOCK_MANAGER` | `{ routeId }` | `route.pickup.confirmed`, type `MANUAL_PICKUP` |
| `POST /dock-tasks/scan` | `SYS_ADMIN`, `DOCK_OPERATOR` | multipart: `routeId`, `locationId`, `barcode`, `photo` | `dock.scan.completed`, type `SCAN_INBOUND` or `SCAN_OUTBOUND` |
| `POST /dock-tasks/missing` | `SYS_ADMIN`, `DOCK_MANAGER` | `{ routeId, locationId, itemId, note }` | `dock.item.missing`, type `MISSING` |
| `POST /dock-tasks/delivery` | `SYS_ADMIN`, `DOCK_MANAGER` | `{ routeId }` | `route.delivery.confirmed`, type `MANUAL_DELIVERY` |
| `GET /dock-tasks?locationId=&routeId=&status=` | `SYS_ADMIN`, `DOCK_MANAGER`, `DOCK_OPERATOR` | none; `status` defaults to `PENDING` | none |

The four actions answer `201` with `{ completedTasks, pendingTasks }`: the tasks the request completed and the `PENDING` tasks it created. `GET` returns the route's non-deleted tasks at that Location, oldest first, each with `itemCode` and `barcode` from the route snapshot. Task numbers come from `MetadataService.nextBusinessCode(DOCK_TASK)`.

**Order of the checks.** A request is validated first (`400` for the body, `404` for an unknown route, barcode, Location, or item, `409` for a state the action does not accept). Only then does it check the broker (`503`), and only then does it write. A request that fails a check writes nothing.

**What the code adds to §4.**

- Pickup takes the route's items that are still `CREATED`. A retried pickup therefore skips the items it already took, and answers `409` when none is left.
- Scan: the photo must be an `image/jpeg` or `image/png` file whose first bytes match that type (`400` otherwise), at most 10 MB (`413`). It is saved as `POD_DIR/<taskId>.jpg|png` (`POD_DIR` defaults to `uploads/pod`, relative to `backend/`, and is ignored by Git). A barcode of an item that is already `EXCEPTION` is `409`.
- Missing: the Location must be a stop of the route and the item must be in the route snapshot (`404`). An item that is already `EXCEPTION` or `DELIVERED` is `409`. When the item has no open scan task there, the leg ids follow the stop: the destination stop sets `inboundLegId`, the origin stop sets `outboundLegId`.
- Delivery answers `409` also when the route has no expected item left.
- If the publish fails after the writes, the request still succeeds and the error is logged. The facts are saved, so `republishPendingRollups()` sends the message again. It runs once at startup, after the consumer starts.

**How the rollup reads §4 and §6.** `StatusRollupService` recomputes from every `COMPLETED` task on the route, so running a message twice writes the same values.

- A stop stays `PENDING` until it is touched: an expected item is handled there, or an item is marked missing there. It is `COMPLETED` when every expected item is handled, otherwise `PROCESSING`.
- The route leaves `PLANNED` only when an item has really left its origin or arrived at its destination. A missing mark alone does not start a route. The route is `COMPLETED` when its destination stop is.
- "`AT_DOCK` at this leg's destination" (§6) means the item has a `COMPLETED` `SCAN_INBOUND` at that destination for this leg. An item that has already left on the next leg still counts as arrived, so leg 1 stays `AT_DOCK` while its items travel on. When the destination is the booking's `DROPOFF` point, the arrival is the manual delivery and the leg becomes `DELIVERED`.
- A leg's origin point follows the route's origin stop once one of its items has left. Its destination point stays `PENDING` until every non-exception item of the leg has arrived, and is then `COMPLETED`.
- A root point at one of the route's stops follows that stop once an item of this booking has left or arrived there. On a shared route it therefore completes with the stop, which is never earlier than the moment every item of the booking has been handled there.
- The root follows the table in §6 with one reading of "forward": `IN_TRANSIT` and `AT_DOCK` alternate hop by hop, while `EXCEPTION` and `DELIVERED` are never left and `CREATED` is never returned to.
- Each message names its tasks and items. If one of them is not on the route, the rollup fails and the message goes through the retry and the dead-letter path of §8.

## 12. Dock desk

A person works at one cross-dock. The route list is how they find a trip. The dock desk is where they handle the goods of that trip at their own dock. The screens below are built. Scanning from the work page is not. This section does not add a collection and it does not change the scan rules in §4.

**Which routes belong to a dock.** A route has two stops. At location L:

- Inbound: `toLocationId` is L. The work here is scan in (§4.2).
- Outbound: `fromLocationId` is L. The work here is scan out (§4.3).

A dock–dock route is outbound at its origin dock and inbound at its destination dock. Confirm pickup and confirm delivery happen at the stores, so they stay on the route page. They are not actions of the dock desk.

`GET /docks/:locationId/routes` lists the non-deleted routes for that dock. `:locationId` must be the ULID of a non-deleted `CROSS_DOCK`. Anything else is `404`. The query requires `direction`: `inbound` or `outbound`. The other filters are the same as `GET /routes`: `status`, `routeNumber`, `serviceDate`, `slot`, `page`, `limit`. Sort stays `appointment.from` ascending, then `id`.

Each row is a `DockRouteResponse`:

| Field | Meaning |
| --- | --- |
| `id`, `routeNumber`, `status` | The route. |
| `serviceDate`, `slot` | Set on a dock–dock route. Absent on a store–dock route. |
| `appointment` | The route window. |
| `shipmentCount` | `shipmentIds.length`. |
| `otherEnd` | `{ id, name, province }` of the stop that is not L. Inbound: stop 1. Outbound: stop 2. |
| `stopSequence` | `2` for inbound, `1` for outbound. |
| `stopStatus` | Status of the stop at L. |
| `pendingTaskCount` | Non-deleted `PENDING` dock tasks with this `routeId` and `locationId` L. |

Locations for the page are loaded with one `find({ id: { $in } })`. Pending counts are loaded with one query grouped by `routeId`, using the index on `routeId`, `locationId`, and `status`. A missing other end keeps its id and null name and province.

The endpoint is public, like `GET /routes`. Swagger documents it. No scan behavior changes.

**Screen.** `/docks` lists `CROSS_DOCK` locations from `GET /locations?type=CROSS_DOCK`. `/docks/:locationId` shows the inbound list and the outbound list, each calling this endpoint. A row opens `/docks/:locationId/routes/:routeId?direction=inbound` or `outbound`.

That work page is the place where scanning will be added later. This step does not call `POST /dock-tasks/scan`, pickup, missing, or delivery. It does prepare the page:

- The heading is the route number, the direction, the other end, and `stopStatus`.
- When the logged-in user is `SYS_ADMIN`, `DOCK_MANAGER`, or `DOCK_OPERATOR`, the page loads `GET /dock-tasks?locationId=&routeId=` and shows the pending rows (`itemCode`, barcode, task type). Anyone else sees the heading and the text that they cannot work this dock. The task request is not sent.
- A scan form sits under the table: barcode, photo, and a submit button. The button is disabled and its title says scanning is not on this screen yet. Mark missing is not shown yet.
- After a later scan returns `201`, this page replaces the task rows from `pendingTasks` immediately. It then reloads `GET /docks/:locationId/routes` for this direction a few times, about half a second apart, and stops when `stopStatus` changes or a few seconds pass. It does not write `IN_PROGRESS` or `COMPLETED` itself. A `503` leaves the task rows as they were. That behavior is not built in this step. The disabled form is the space it will occupy.
