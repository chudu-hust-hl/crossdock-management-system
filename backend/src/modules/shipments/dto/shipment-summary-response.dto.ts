import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { TimeWindowResponse } from '../../../common/dto/time-window.dto';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { Page } from '../../../common/utils/pagination.util';
import { ItemUnit } from '../../items/enums/item-unit.enum';
import { WeightUnit } from '../../items/enums/weight-unit.enum';
import { ItemSummary } from '../../items/items.service';
import { LocationType } from '../../locations/enums/location-type.enum';
import { LocationSummary } from '../../locations/locations.service';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { DeliveryInfo } from '../schemas/delivery-info.schema';
import { Shipment } from '../schemas/shipment.schema';

/** The store at one end of a booking. A missing Location keeps its id; the rest is `null`. */
export class ShipmentEndResponse {
  @ApiProperty({ description: 'ULID of the Location.' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Store A' })
  name!: string | null;

  @ApiProperty({
    enum: LocationType,
    enumName: 'LocationType',
    nullable: true,
  })
  type!: LocationType | null;

  @ApiProperty({ type: String, nullable: true, example: 'Hanoi' })
  province!: string | null;
}

export class ShipmentSummaryItemResponse {
  @ApiProperty({ description: 'ULID of the Item.' })
  id!: string;

  @ApiProperty({ example: 'T-0001-1026' })
  itemCode!: string;

  @ApiProperty({ enum: ItemUnit, enumName: 'ItemUnit' })
  itemUnit!: ItemUnit;

  @ApiPropertyOptional({ example: 2.5 })
  weight?: number;

  @ApiPropertyOptional({ enum: WeightUnit, enumName: 'WeightUnit' })
  weightUnit?: WeightUnit;
}

/** One row of `GET /shipments`: the shipment with its two stores and its items. */
export class ShipmentSummaryResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: 'S-0001-1026' })
  code!: string;

  @ApiProperty({ enum: ShipmentStatus, enumName: 'ShipmentStatus' })
  status!: ShipmentStatus;

  @ApiPropertyOptional({
    example: 'Cong ty TNHH ABC',
    description: 'Set on a root shipment (booking).',
  })
  customerName?: string;

  @ApiPropertyOptional({
    example: 47500,
    description: 'Whole VND; set on a root shipment (booking).',
  })
  cost?: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    type: ShipmentEndResponse,
    nullable: true,
    description: 'The PICKUP point; `null` when the shipment has none (a leg).',
  })
  origin!: ShipmentEndResponse | null;

  @ApiProperty({
    type: ShipmentEndResponse,
    nullable: true,
    description:
      'The DROPOFF point; `null` when the shipment has none (a leg).',
  })
  destination!: ShipmentEndResponse | null;

  @ApiProperty({
    type: TimeWindowResponse,
    description: 'Appointment of the PICKUP point.',
  })
  pickupAppointment!: TimeWindowResponse;

  @ApiProperty({
    type: TimeWindowResponse,
    description: 'Appointment of the DROPOFF point.',
  })
  dropoffAppointment!: TimeWindowResponse;

  @ApiProperty({
    type: [ShipmentSummaryItemResponse],
    description: 'In `itemIds` order.',
  })
  items!: ShipmentSummaryItemResponse[];

  @ApiProperty({
    description: '`true` when routing inserted at least one TRANSIT point.',
  })
  routed!: boolean;
}

/** One page of `GET /shipments`. */
export class ShipmentPageResponse extends PageResponse {
  @ApiProperty({ type: [ShipmentSummaryResponse] })
  items!: ShipmentSummaryResponse[];
}

/** A page of shipments and the Locations and Items its rows reference. */
export interface ShipmentSummaryPage {
  page: Page<Shipment>;
  locations: LocationSummary[];
  items: ItemSummary[];
}

export function toShipmentPageResponse({
  page,
  locations,
  items,
}: ShipmentSummaryPage): ShipmentPageResponse {
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return {
    ...page,
    items: page.items.map((shipment) =>
      toShipmentSummaryResponse(shipment, locationsById, itemsById),
    ),
  };
}

function toShipmentSummaryResponse(
  shipment: Shipment,
  locationsById: Map<string, LocationSummary>,
  itemsById: Map<string, ItemSummary>,
): ShipmentSummaryResponse {
  const pickup = pointOfType(shipment, DeliveryPointType.PICKUP);
  const dropoff = pointOfType(shipment, DeliveryPointType.DROPOFF);
  return {
    id: shipment.id,
    code: shipment.code,
    status: shipment.status,
    customerName: shipment.customerName,
    cost: shipment.cost,
    createdAt: shipment.createdAt,
    origin: pickup ? toEnd(pickup.locationId, locationsById) : null,
    destination: dropoff ? toEnd(dropoff.locationId, locationsById) : null,
    pickupAppointment: appointmentOf(pickup),
    dropoffAppointment: appointmentOf(dropoff),
    items: shipment.itemIds
      .map((id) => itemsById.get(id))
      .filter((item): item is ItemSummary => item !== undefined)
      .map((item) => ({
        id: item.id,
        itemCode: item.itemCode,
        itemUnit: item.itemUnit,
        weight: item.weight,
        weightUnit: item.weightUnit,
      })),
    routed: shipment.deliveryInfos.some(
      (info) => info.type === DeliveryPointType.TRANSIT,
    ),
  };
}

function pointOfType(
  shipment: Shipment,
  type: DeliveryPointType,
): DeliveryInfo | undefined {
  return shipment.deliveryInfos.find((info) => info.type === type);
}

function toEnd(
  id: string,
  locationsById: Map<string, LocationSummary>,
): ShipmentEndResponse {
  const location = locationsById.get(id);
  return {
    id,
    name: location?.name ?? null,
    type: location?.type ?? null,
    province: location?.address?.province ?? null,
  };
}

function appointmentOf(point: DeliveryInfo | undefined): TimeWindowResponse {
  return point
    ? { from: point.appointment.from, to: point.appointment.to }
    : { from: null, to: null };
}
