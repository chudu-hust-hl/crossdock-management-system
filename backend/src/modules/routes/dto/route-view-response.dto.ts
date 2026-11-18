import { ApiProperty } from '@nestjs/swagger';
import { AddressDto } from '../../locations/dto/address.dto';
import { LocationType } from '../../locations/enums/location-type.enum';
import { Address } from '../../locations/schemas/address.schema';
import { ShipmentStatus } from '../../shipments/enums/shipment-status.enum';
import { RouteResponse, toRouteResponse } from './route-response.dto';
import { Route } from '../schemas/route.schema';

/** One stop's Location on `GET /routes/:id`. */
export class RouteLocationResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: 'Hanoi Cross-dock' })
  name!: string;

  @ApiProperty({ enum: LocationType, enumName: 'LocationType' })
  type!: LocationType;

  @ApiProperty({ type: AddressDto })
  address!: Address;
}

/** One child shipment listed on the route, in `shipmentIds` order. */
export class RouteShipmentResponse {
  @ApiProperty({ description: 'Public ULID of the child shipment.' })
  id!: string;

  @ApiProperty({ example: 'S-0002-1126' })
  code!: string;

  @ApiProperty({ enum: ShipmentStatus, enumName: 'ShipmentStatus' })
  status!: ShipmentStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ULID of the root shipment.',
  })
  parentId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The root shipment's customer name.",
  })
  customerName!: string | null;

  @ApiProperty({ description: 'Number of items on this child.' })
  itemCount!: number;
}

/** `GET /routes/:id` and the body returned after a move. */
export class RouteViewResponse {
  @ApiProperty({ type: RouteResponse })
  route!: RouteResponse;

  @ApiProperty({
    type: [RouteLocationResponse],
    description:
      'The two stop Locations, in stop order. A missing one is omitted.',
  })
  locations!: RouteLocationResponse[];

  @ApiProperty({
    type: [RouteShipmentResponse],
    description:
      'One entry per id in `route.shipmentIds`, in that order. A missing shipment is omitted.',
  })
  shipments!: RouteShipmentResponse[];
}

export interface RouteStopLocation {
  id: string;
  name: string;
  type: LocationType;
  address: Address;
}

export function toRouteViewResponse(view: {
  route: Route;
  locations: RouteStopLocation[];
  shipments: RouteShipmentResponse[];
}): RouteViewResponse {
  return {
    route: toRouteResponse(view.route),
    locations: view.locations,
    shipments: view.shipments,
  };
}
