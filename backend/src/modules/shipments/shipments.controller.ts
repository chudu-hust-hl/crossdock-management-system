import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UlidParamDto } from '../../common/dto/ulid-param.dto';
import { UpdateItemDto } from '../items/dto/update-item.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { ShipmentItemParamDto } from './dto/shipment-item-param.dto';
import {
  BookShipmentResponse,
  ShipmentResponse,
  toBookShipmentResponse,
  toShipmentResponse,
} from './dto/shipment-response.dto';
import {
  ShipmentPageResponse,
  toShipmentPageResponse,
} from './dto/shipment-summary-response.dto';
import {
  ShipmentViewResponse,
  toShipmentViewResponse,
} from './dto/shipment-view-response.dto';
import { UpdateAppointmentsDto } from './dto/update-appointments.dto';
import { UpdateShipmentCustomerDto } from './dto/update-shipment-customer.dto';
import { ShipmentEditsService } from './shipment-edits.service';
import { ShipmentsService } from './shipments.service';

@ApiTags('shipments')
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly editsService: ShipmentEditsService,
  ) {}

  @Post('book')
  @ApiOperation({
    summary:
      'Book a shipment: endpoints, items, cost, and routing in one operation',
    description:
      'Each endpoint is resolved to a STORE: a store with the same `name`, `contactName` and ' +
      '`address.postalCode` (ignoring case and extra whitespace) is reused, otherwise one is created. ' +
      'Every entry of `items` becomes a new Item at the pickup Location; existing Items are never ' +
      'reused. The shipment gets a generated `code` (`S-<nnnn>-MMYY`), the calculated `cost`, and ' +
      'status `CREATED`. Routing then inserts the cross-dock hubs into `deliveryInfos` when each ' +
      'province has exactly one ACTIVE cross-dock. The pickup and drop-off appointments are kept. ' +
      'Each hop then becomes its own child shipment, listed in `childrenIds`. ' +
      'Each child is placed on a route: a store and a dock get their own route, and two docks share ' +
      "that direction's morning or evening route. No dock task is created. " +
      'If routing cannot choose the hubs, those two delivery infos stay, `childrenIds` stays empty, ' +
      'and `routingStoppedReason` says why. A failed booking is undone; a routing miss, a failed ' +
      'child insert, or a failed route assignment is not.',
  })
  @ApiCreatedResponse({ type: BookShipmentResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid body (e.g. no items); pickup and drop-off are the same Location; or an endpoint ' +
      'resolves to an INACTIVE Location.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'An item barcode is already registered.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'Pricing rates (PRICING_* variables) are not configured.',
  })
  async create(@Body() dto: CreateShipmentDto): Promise<BookShipmentResponse> {
    const booked = await this.shipmentsService.create(dto);
    return toBookShipmentResponse(booked.shipment, booked.routingStoppedReason);
  }

  @Get()
  @ApiOperation({
    summary: 'List non-deleted Shipments: filtered, sorted and paginated',
    description:
      'Root shipments (bookings) and segments (legs) are listed together; use `isRoot` or ' +
      '`parentId` to choose. All filters are optional and combined with AND. `code` and ' +
      '`customerName` match any part of the value, ignoring case. Default: newest first ' +
      '(`createdAt` descending), page 1 of 20. A page past the last one returns no `items`. ' +
      'Each row is a summary: the PICKUP and DROPOFF stores with their appointments, the ' +
      'items, and whether routing inserted a hub.',
  })
  @ApiOkResponse({ type: ShipmentPageResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query, e.g. an unknown `status` or `sortBy`, an `itemId` that is not a ULID, ' +
      '`limit` above 100, an unknown parameter, or `parentId` together with `isRoot=true`.',
  })
  async findAll(
    @Query() query: ListShipmentsQueryDto,
  ): Promise<ShipmentPageResponse> {
    return toShipmentPageResponse(
      await this.shipmentsService.findSummaryPage(query),
    );
  }

  // Declared before `GET :id`, so that `view` is never read as an id.
  @Get(':id/view')
  @ApiOperation({
    summary: 'Get one booking with its Locations, Items, legs and routes',
    description:
      '`id` must be a root shipment. `children` follow `childrenIds`, `items` follow ' +
      '`itemIds`, and `routes` are the non-deleted routes carrying one of the children.',
  })
  @ApiOkResponse({ type: ShipmentViewResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`id` is not a ULID.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such booking: unknown, deleted, or a child shipment.',
  })
  async findView(@Param() params: UlidParamDto): Promise<ShipmentViewResponse> {
    return toShipmentViewResponse(
      await this.shipmentsService.findView(params.id),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one Shipment by its ULID' })
  @ApiOkResponse({ type: ShipmentResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`id` is not a ULID.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such Shipment, or it was deleted.',
  })
  async findOne(@Param() params: UlidParamDto): Promise<ShipmentResponse> {
    return toShipmentResponse(await this.shipmentsService.findById(params.id));
  }

  @Put(':id')
  @ApiOperation({
    summary: "Change a booking's customer name",
    description:
      'Only while the booking is `CREATED`. Children have no customer.',
  })
  @ApiOkResponse({ type: ShipmentResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`id` is not a ULID, or the customer name is empty.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such booking: unknown, deleted, or a child shipment.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The booking is no longer `CREATED`.',
  })
  async updateCustomer(
    @Param() params: UlidParamDto,
    @Body() dto: UpdateShipmentCustomerDto,
  ): Promise<ShipmentResponse> {
    return toShipmentResponse(
      await this.editsService.updateCustomer(params.id, dto),
    );
  }

  @Put(':id/appointments')
  @ApiOperation({
    summary: "Change a booking's pickup and drop-off appointments",
    description:
      'Only while the booking is `CREATED`. Both windows are required: `from` before `to`, ' +
      'and the pickup ends no later than the drop-off starts. The pickup window is written ' +
      'to the root PICKUP point and to point 1 of the leg starting at that store; the ' +
      'drop-off window to the root DROPOFF point and to point 2 of the leg ending there. ' +
      "Those legs' dedicated routes and their store stops get the same window. A dock–dock " +
      'route keeps its slot window.',
  })
  @ApiOkResponse({ type: ShipmentViewResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid `id` or body, or windows in the wrong order.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such booking: unknown, deleted, or a child shipment.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The booking is no longer `CREATED`.',
  })
  async updateAppointments(
    @Param() params: UlidParamDto,
    @Body() dto: UpdateAppointmentsDto,
  ): Promise<ShipmentViewResponse> {
    return toShipmentViewResponse(
      await this.editsService.updateAppointments(params.id, dto),
    );
  }

  @Put(':id/items/:itemId')
  @ApiOperation({
    summary: 'Correct one booked item',
    description:
      'Only while the booking is `CREATED`. Fields that are not sent keep their value; ' +
      '`description: null` removes it. The booking cost is recalculated from all its items, ' +
      "and the item's rows in the route snapshots get the new description, unit and weight.",
  })
  @ApiOkResponse({ type: ShipmentViewResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid ids or body, e.g. a weight without `weightUnit` or a `barcode`.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such booking, or the item is not on it.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The booking is no longer `CREATED`.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'Pricing rates (PRICING_* variables) are not configured.',
  })
  async updateItem(
    @Param() params: ShipmentItemParamDto,
    @Body() dto: UpdateItemDto,
  ): Promise<ShipmentViewResponse> {
    return toShipmentViewResponse(
      await this.editsService.updateItem(params.id, params.itemId, dto),
    );
  }
}
