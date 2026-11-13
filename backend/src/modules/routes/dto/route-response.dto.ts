import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TimeWindowResponse } from '../../../common/dto/time-window.dto';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { TimeWindow } from '../../../common/schemas/time-window.schema';
import { RouteSlot } from '../enums/route-slot.enum';
import { RouteStatus } from '../enums/route-status.enum';
import { RouteItem } from '../schemas/route-item.schema';
import { RouteStop } from '../schemas/route-stop.schema';
import { Route } from '../schemas/route.schema';

export class RouteStopResponse {
  @ApiProperty({ example: 1 })
  sequence!: number;

  @ApiProperty({ description: 'ULID of the Location.' })
  locationId!: string;

  @ApiProperty({ enum: DeliveryPointType, enumName: 'DeliveryPointType' })
  type!: DeliveryPointType;

  @ApiProperty({
    type: [String],
    description: 'ULIDs of the child shipments handled at this stop.',
  })
  shipmentIds!: string[];

  @ApiProperty({ type: TimeWindowResponse })
  appointment!: TimeWindowResponse;

  @ApiProperty({ type: TimeWindowResponse })
  actualWindow!: TimeWindowResponse;

  @ApiProperty({ enum: DeliveryPointStatus, enumName: 'DeliveryPointStatus' })
  status!: DeliveryPointStatus;
}

/** One row of the route's item snapshot, as far as a booking view needs it. */
export class RouteItemResponse {
  @ApiProperty({ description: 'ULID of the Item.' })
  itemId!: string;

  @ApiProperty({ description: 'ULID of the child shipment carrying it.' })
  shipmentId!: string;

  @ApiProperty({ example: 'T-0001-1026' })
  itemCode!: string;

  @ApiProperty({ example: '8930000000017' })
  barcode!: string;
}

/** A Route as returned by the API: public ULID `id`, no `_id` or `deletedAt`. */
export class RouteResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: 'R-0001-1026' })
  routeNumber!: string;

  @ApiProperty({ enum: RouteStatus, enumName: 'RouteStatus' })
  status!: RouteStatus;

  @ApiProperty({ example: 'Nguyen Van Tai' })
  driverName!: string;

  @ApiProperty({ example: '29A-000.01' })
  vehiclePlate!: string;

  @ApiPropertyOptional({
    example: '2026-10-27',
    description:
      'Vietnam day of a dock–dock route; absent on a dedicated route.',
  })
  serviceDate?: string;

  @ApiPropertyOptional({
    enum: RouteSlot,
    enumName: 'RouteSlot',
    description: 'Set on a dock–dock route; absent on a dedicated route.',
  })
  slot?: RouteSlot;

  @ApiProperty({ type: TimeWindowResponse })
  appointment!: TimeWindowResponse;

  @ApiProperty({ description: 'ULID of the Location of stop 1.' })
  fromLocationId!: string;

  @ApiProperty({ description: 'ULID of the Location of stop 2.' })
  toLocationId!: string;

  @ApiProperty({
    type: [String],
    description: 'ULIDs of the child shipments on this route.',
  })
  shipmentIds!: string[];

  @ApiProperty({ type: [RouteStopResponse] })
  stops!: RouteStopResponse[];

  @ApiProperty({ type: [RouteItemResponse] })
  items!: RouteItemResponse[];
}

export function toRouteResponse(route: Route): RouteResponse {
  return {
    id: route.id,
    routeNumber: route.routeNumber,
    status: route.status,
    driverName: route.driverName,
    vehiclePlate: route.vehiclePlate,
    serviceDate: route.serviceDate,
    slot: route.slot,
    appointment: toWindow(route.appointment),
    fromLocationId: route.fromLocationId,
    toLocationId: route.toLocationId,
    shipmentIds: route.shipmentIds,
    stops: route.stops.map(toRouteStopResponse),
    items: route.items.map(toRouteItemResponse),
  };
}

function toRouteStopResponse(stop: RouteStop): RouteStopResponse {
  return {
    sequence: stop.sequence,
    locationId: stop.locationId,
    type: stop.type,
    shipmentIds: stop.shipmentIds,
    appointment: toWindow(stop.appointment),
    actualWindow: toWindow(stop.actualWindow),
    status: stop.status,
  };
}

function toRouteItemResponse(item: RouteItem): RouteItemResponse {
  return {
    itemId: item.itemId,
    shipmentId: item.shipmentId,
    itemCode: item.itemCode,
    barcode: item.barcode,
  };
}

function toWindow(window: TimeWindow): TimeWindowResponse {
  return { from: window.from, to: window.to };
}
