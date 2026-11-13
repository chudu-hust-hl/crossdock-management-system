/*
 * Response bodies of the backend API, as described by its `*Response` classes and
 * Swagger (/docs). Every `id` and reference is a ULID string, never a MongoDB `_id`.
 * Dates arrive as ISO 8601 strings.
 */

/** One page of a list endpoint (`PageResponse`). */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  /** Number of matching records on all pages. */
  total: number;
}

export const LOCATION_TYPES = ['WAREHOUSE', 'CROSS_DOCK', 'STORE', 'CUSTOMER'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  ward?: string;
  district?: string;
  city?: string;
  province?: string;
  postalCode: string;
  country?: string;
}

/** `LocationResponse` */
export interface Location {
  id: string;
  name: string;
  type: LocationType;
  address: Address;
  contactName?: string;
  contactPhone?: string;
  status: LocationStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const SHIPMENT_STATUSES = [
  'CREATED',
  'IN_TRANSIT',
  'AT_DOCK',
  'DELIVERED',
  'CANCELLED',
  'EXCEPTION',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface TimeWindow {
  from: string | null;
  to: string | null;
}

/** `DeliveryInfoResponse` */
export interface DeliveryInfo {
  sequence: number;
  locationId: string;
  type: 'PICKUP' | 'TRANSIT' | 'DROPOFF';
  appointment: TimeWindow;
  actualWindow: TimeWindow;
  status: 'PENDING' | 'ARRIVED' | 'PROCESSING' | 'COMPLETED' | 'SKIPPED';
  metadata?: Record<string, unknown>;
}

export const ITEM_UNITS = ['BOX', 'PALLET', 'KEG', 'BAG'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export const WEIGHT_UNITS = ['KG', 'LB'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DIMENSION_UNITS = ['CM', 'IN'] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: DimensionUnit;
}

/** `ShipmentResponse` */
export interface Shipment {
  id: string;
  code: string;
  /** `null` for a root shipment (a booking); the root's ULID for a segment (leg). */
  parentId: string | null;
  /** Child shipment ULIDs, in path order. Empty until they exist. */
  childrenIds: string[];
  customerName?: string;
  /** Whole VND. */
  cost?: number;
  itemIds: string[];
  deliveryInfos: DeliveryInfo[];
  status: ShipmentStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `ShipmentEndResponse`: a store at one end. A missing Location keeps only its id. */
export interface ShipmentEnd {
  id: string;
  name: string | null;
  type: LocationType | null;
  province: string | null;
}

/** `ShipmentSummaryResponse`: one row of `GET /shipments`. */
export interface ShipmentSummary {
  id: string;
  code: string;
  status: ShipmentStatus;
  customerName?: string;
  /** Whole VND. */
  cost?: number;
  createdAt: string;
  /** The PICKUP store; `null` for a leg without one. */
  origin: ShipmentEnd | null;
  /** The DROPOFF store; `null` for a leg without one. */
  destination: ShipmentEnd | null;
  pickupAppointment: TimeWindow;
  dropoffAppointment: TimeWindow;
  /** In `itemIds` order. */
  items: {
    id: string;
    itemCode: string;
    itemUnit: ItemUnit;
    weight?: number;
    weightUnit?: WeightUnit;
  }[];
  /** At least one TRANSIT point. */
  routed: boolean;
}

/** `ItemResponse` */
export interface Item {
  id: string;
  itemCode: string;
  barcode: string;
  description?: string;
  itemUnit: ItemUnit;
  weight?: number;
  weightUnit?: WeightUnit;
  dimensions?: Dimensions;
  status: 'CREATED' | 'IN_TRANSIT' | 'AT_DOCK' | 'DELIVERED' | 'EXCEPTION';
  currentLocationId?: string;
  currentShipmentId?: string;
}

/** `RouteStopResponse` */
export interface RouteStop {
  sequence: number;
  locationId: string;
  type: DeliveryInfo['type'];
  shipmentIds: string[];
  appointment: TimeWindow;
  actualWindow: TimeWindow;
  status: DeliveryInfo['status'];
}

/** `RouteResponse`. `items` is the snapshot taken when the leg was assigned. */
export interface Route {
  id: string;
  routeNumber: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  driverName: string;
  vehiclePlate: string;
  /** Set with `slot` on a dock–dock route; absent on a dedicated route. */
  serviceDate?: string;
  slot?: 'MORNING' | 'EVENING';
  appointment: TimeWindow;
  fromLocationId: string;
  toLocationId: string;
  shipmentIds: string[];
  stops: RouteStop[];
  items: { itemId: string; shipmentId: string; itemCode: string; barcode: string }[];
}

/** `ShipmentViewResponse`: `GET /shipments/:id/view` and the answer of two PUTs. */
export interface ShipmentView {
  shipment: Shipment;
  /** Every Location the booking and its legs reference; match by `id`. */
  locations: Location[];
  /** In `itemIds` order. */
  items: Item[];
  /** In `childrenIds` order. */
  children: Shipment[];
  routes: Route[];
}

/** Body of `PUT /shipments/:id/appointments`. Dates are ISO 8601 strings. */
export interface AppointmentsUpdate {
  pickup: { from: string; to: string };
  dropoff: { from: string; to: string };
}

/** Body of `PUT /shipments/:id/items/:itemId`; `description: null` removes it. */
export interface ItemUpdate {
  description: string | null;
  itemUnit: ItemUnit;
  weight: number;
  weightUnit: WeightUnit;
  dimensions?: Dimensions;
}
