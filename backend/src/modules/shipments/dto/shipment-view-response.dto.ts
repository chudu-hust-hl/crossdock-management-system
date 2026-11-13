import { ApiProperty } from '@nestjs/swagger';
import {
  ItemResponse,
  toItemResponse,
} from '../../items/dto/item-response.dto';
import { Item } from '../../items/schemas/item.schema';
import {
  LocationResponse,
  toLocationResponse,
} from '../../locations/dto/location-response.dto';
import { Location } from '../../locations/schemas/location.schema';
import {
  RouteResponse,
  toRouteResponse,
} from '../../routes/dto/route-response.dto';
import { Route } from '../../routes/schemas/route.schema';
import { Shipment } from '../schemas/shipment.schema';
import { ShipmentResponse, toShipmentResponse } from './shipment-response.dto';

/** `GET /shipments/:id/view`: one booking with everything its screen shows. */
export class ShipmentViewResponse {
  @ApiProperty({ type: ShipmentResponse, description: 'The root shipment.' })
  shipment!: ShipmentResponse;

  @ApiProperty({
    type: [LocationResponse],
    description:
      'Every Location referenced by the root and its children; match them by `id`.',
  })
  locations!: LocationResponse[];

  @ApiProperty({
    type: [ItemResponse],
    description: "The root's Items, in `itemIds` order.",
  })
  items!: ItemResponse[];

  @ApiProperty({
    type: [ShipmentResponse],
    description: 'The child shipments (legs), in `childrenIds` order.',
  })
  children!: ShipmentResponse[];

  @ApiProperty({
    type: [RouteResponse],
    description: 'Non-deleted routes that carry at least one of the children.',
  })
  routes!: RouteResponse[];
}

/** The documents a booking view is built from, already in display order. */
export interface ShipmentView {
  shipment: Shipment;
  locations: Location[];
  items: Item[];
  children: Shipment[];
  routes: Route[];
}

export function toShipmentViewResponse(
  view: ShipmentView,
): ShipmentViewResponse {
  return {
    shipment: toShipmentResponse(view.shipment),
    locations: view.locations.map(toLocationResponse),
    items: view.items.map(toItemResponse),
    children: view.children.map(toShipmentResponse),
    routes: view.routes.map(toRouteResponse),
  };
}
