import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { TimeWindowResponse } from '../../../common/dto/time-window.dto';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { Page } from '../../../common/utils/pagination.util';
import { LocationSummary } from '../../locations/locations.service';
import { RouteSlot } from '../enums/route-slot.enum';
import { RouteStatus } from '../enums/route-status.enum';
import { Route } from '../schemas/route.schema';
import { DockDirection } from './list-dock-routes-query.dto';

/** The stop that is not this dock. A missing Location keeps its id. */
export class DockRouteEndResponse {
  @ApiProperty({ description: 'ULID of the Location.' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Hanoi Cross-dock' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Hanoi' })
  province!: string | null;
}

/** One row of `GET /docks/:locationId/routes`. */
export class DockRouteResponse {
  @ApiProperty({ description: 'Public ULID.' })
  id!: string;

  @ApiProperty({ example: 'R-0001-1126' })
  routeNumber!: string;

  @ApiProperty({ enum: RouteStatus, enumName: 'RouteStatus' })
  status!: RouteStatus;

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

  @ApiProperty({
    type: DockRouteEndResponse,
    description: 'Stop 1 when inbound, stop 2 when outbound.',
  })
  otherEnd!: DockRouteEndResponse;

  @ApiProperty({
    description: '`2` when inbound, `1` when outbound.',
    example: 2,
  })
  stopSequence!: number;

  @ApiProperty({
    enum: DeliveryPointStatus,
    enumName: 'DeliveryPointStatus',
    description: 'Status of the stop at this dock.',
  })
  stopStatus!: DeliveryPointStatus;

  @ApiProperty({
    description: 'Non-deleted PENDING dock tasks for this route at this dock.',
  })
  pendingTaskCount!: number;
}

export class DockRoutePageResponse extends PageResponse {
  @ApiProperty({ type: [DockRouteResponse] })
  items!: DockRouteResponse[];
}

export function toDockRoutePageResponse(
  page: Page<Route>,
  direction: DockDirection,
  locations: LocationSummary[],
  pending: Map<string, number>,
): DockRoutePageResponse {
  const inbound = direction === DockDirection.INBOUND;
  const byId = new Map(locations.map((location) => [location.id, location]));
  return {
    page: page.page,
    limit: page.limit,
    total: page.total,
    items: page.items.map((route) => {
      const dockId = inbound ? route.toLocationId : route.fromLocationId;
      const otherId = inbound ? route.fromLocationId : route.toLocationId;
      const other = byId.get(otherId);
      const stop = route.stops.find((item) => item.locationId === dockId);
      if (!stop) {
        throw new Error(`Route ${route.routeNumber} has no stop at ${dockId}`);
      }
      return {
        id: route.id,
        routeNumber: route.routeNumber,
        status: route.status,
        ...(route.serviceDate != null && { serviceDate: route.serviceDate }),
        ...(route.slot != null && { slot: route.slot }),
        appointment: {
          from: route.appointment.from,
          to: route.appointment.to,
        },
        shipmentCount: route.shipmentIds.length,
        otherEnd: {
          id: otherId,
          name: other?.name ?? null,
          province: other?.address.province ?? null,
        },
        stopSequence: inbound ? 2 : 1,
        stopStatus: stop.status,
        pendingTaskCount: pending.get(route.id) ?? 0,
      };
    }),
  };
}
