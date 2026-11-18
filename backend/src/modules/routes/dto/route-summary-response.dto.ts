import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { TimeWindowResponse } from '../../../common/dto/time-window.dto';
import { Page } from '../../../common/utils/pagination.util';
import { LocationType } from '../../locations/enums/location-type.enum';
import { LocationSummary } from '../../locations/locations.service';
import { RouteSlot } from '../enums/route-slot.enum';
import { RouteStatus } from '../enums/route-status.enum';
import { Route } from '../schemas/route.schema';

/** One end of a route in a list. A missing Location keeps its id; the rest is `null`. */
export class RouteEndResponse {
  @ApiProperty({ description: 'ULID of the Location.' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Hanoi Cross-dock' })
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

/** One row of `GET /routes`. */
export class RouteSummaryResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: 'R-0001-1126' })
  routeNumber!: string;

  @ApiProperty({ enum: RouteStatus, enumName: 'RouteStatus' })
  status!: RouteStatus;

  @ApiProperty({ example: 'Nguyen Van Tai' })
  driverName!: string;

  @ApiProperty({ example: '29A-000.01' })
  vehiclePlate!: string;

  @ApiPropertyOptional({
    example: '2026-11-18',
    description: 'Set on a dock–dock route only.',
  })
  serviceDate?: string;

  @ApiPropertyOptional({
    enum: RouteSlot,
    enumName: 'RouteSlot',
    description: 'Set on a dock–dock route only.',
  })
  slot?: RouteSlot;

  @ApiProperty({ type: TimeWindowResponse })
  appointment!: TimeWindowResponse;

  @ApiProperty({ description: 'Number of child shipments on this route.' })
  shipmentCount!: number;

  @ApiProperty({ type: RouteEndResponse, description: 'Stop 1.' })
  from!: RouteEndResponse;

  @ApiProperty({ type: RouteEndResponse, description: 'Stop 2.' })
  to!: RouteEndResponse;
}

export class RoutePageResponse extends PageResponse {
  @ApiProperty({ type: [RouteSummaryResponse] })
  items!: RouteSummaryResponse[];
}

function toEnd(
  id: string,
  locations: Map<string, LocationSummary>,
): RouteEndResponse {
  const location = locations.get(id);
  return {
    id,
    name: location?.name ?? null,
    type: location?.type ?? null,
    province: location?.address.province ?? null,
  };
}

export function toRoutePageResponse(
  page: Page<Route>,
  locations: LocationSummary[],
): RoutePageResponse {
  const byId = new Map(locations.map((location) => [location.id, location]));
  return {
    page: page.page,
    limit: page.limit,
    total: page.total,
    items: page.items.map((route) => ({
      id: route.id,
      routeNumber: route.routeNumber,
      status: route.status,
      driverName: route.driverName,
      vehiclePlate: route.vehiclePlate,
      ...(route.serviceDate != null && { serviceDate: route.serviceDate }),
      ...(route.slot != null && { slot: route.slot }),
      appointment: {
        from: route.appointment.from,
        to: route.appointment.to,
      },
      shipmentCount: route.shipmentIds.length,
      from: toEnd(route.fromLocationId, byId),
      to: toEnd(route.toLocationId, byId),
    })),
  };
}
