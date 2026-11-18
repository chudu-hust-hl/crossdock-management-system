import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UlidParamDto } from '../../common/dto/ulid-param.dto';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AddRouteShipmentsDto } from './dto/add-route-shipments.dto';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { RouteCandidateResponse } from './dto/route-candidate-response.dto';
import { RoutePageResponse } from './dto/route-summary-response.dto';
import { RouteViewResponse } from './dto/route-view-response.dto';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  @ApiOperation({
    summary: 'List routes',
    description:
      'Non-deleted routes, paged. Sorted by `appointment.from` ascending, then `id`. ' +
      'Filters: `status`, a case-insensitive part of `routeNumber`, an exact `serviceDate` ' +
      '(`YYYY-MM-DD`), and `slot`.',
  })
  @ApiOkResponse({ type: RoutePageResponse })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  findPage(@Query() query: ListRoutesQueryDto): Promise<RoutePageResponse> {
    return this.routesService.findPage(query);
  }

  @Get(':id/candidates')
  @ApiOperation({
    summary: 'List child shipments that may be added to this route',
    description:
      "CREATED, non-deleted children whose two delivery infos are this route's " +
      '`fromLocationId` then `toLocationId`, and that are not already on this route. ' +
      'An empty list is `200`.',
  })
  @ApiOkResponse({ type: [RouteCandidateResponse] })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findCandidates(
    @Param() { id }: UlidParamDto,
  ): Promise<RouteCandidateResponse[]> {
    return this.routesService.findCandidates(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one route with its stop locations and shipments',
  })
  @ApiOkResponse({ type: RouteViewResponse })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param() { id }: UlidParamDto): Promise<RouteViewResponse> {
    return this.routesService.findView(id);
  }

  @Post(':id/shipments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_MANAGER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Move CREATED child shipments onto this planned route',
    description:
      'The route must be `PLANNED` and already have the same two ends. Each id is a ' +
      'CREATED child with those ends, not already on this route, and without a dock task. ' +
      'The child is removed from its current route (that route is soft-deleted if it ' +
      'becomes empty) and appended here, including both stops and item snapshots. ' +
      'Stops are not added or reordered. No dock task is created.',
  })
  @ApiOkResponse({ type: RouteViewResponse })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  addShipments(
    @Param() { id }: UlidParamDto,
    @Body() body: AddRouteShipmentsDto,
  ): Promise<RouteViewResponse> {
    return this.routesService.addShipments(id, body.shipmentIds);
  }
}
