import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { DockLocationParamDto } from './dto/dock-location-param.dto';
import { DockRoutePageResponse } from './dto/dock-route-response.dto';
import { ListDockRoutesQueryDto } from './dto/list-dock-routes-query.dto';
import { RoutesService } from './routes.service';

/**
 * The dock desk's route list. It lives at `/docks`, not under `/routes/:id`,
 * so the route id handler cannot capture it.
 */
@ApiTags('docks')
@Controller('docks')
export class DocksController {
  constructor(private readonly routesService: RoutesService) {}

  @Get(':locationId/routes')
  @ApiOperation({
    summary: 'List inbound or outbound routes at a cross-dock',
    description:
      '`direction` is required. `inbound` keeps routes whose `toLocationId` is this dock. ' +
      '`outbound` keeps routes whose `fromLocationId` is this dock. ' +
      'The other filters match `GET /routes`. Sorted by `appointment.from` ascending, then `id`.',
  })
  @ApiOkResponse({ type: DockRoutePageResponse })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findPage(
    @Param() { locationId }: DockLocationParamDto,
    @Query() query: ListDockRoutesQueryDto,
  ): Promise<DockRoutePageResponse> {
    return this.routesService.findForDock(locationId, query);
  }
}
