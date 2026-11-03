import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import {
  ShipmentPageResponse,
  ShipmentResponse,
  toShipmentPageResponse,
  toShipmentResponse,
} from './dto/shipment-response.dto';
import { ShipmentsService } from './shipments.service';

@ApiTags('shipments')
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post('book')
  @ApiOperation({
    summary: 'Book a shipment: endpoints, items, and cost in one operation',
    description:
      'Each endpoint is resolved to a STORE: a store with the same `name`, `contactName` and ' +
      '`address.postalCode` (ignoring case and extra whitespace) is reused, otherwise one is created. ' +
      'Every entry of `items` becomes a new Item at the pickup Location; existing Items are never ' +
      'reused. The shipment gets a generated `code` (`S-<nnnn>-MMYY`), the calculated `cost`, ' +
      'status `CREATED`, and two delivery infos: `PICKUP` (sequence 1) and `DROPOFF` (sequence 2). ' +
      'If any step fails, nothing of the booking is kept. Routing is not done yet.',
  })
  @ApiCreatedResponse({ type: ShipmentResponse })
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
  async create(@Body() dto: CreateShipmentDto): Promise<ShipmentResponse> {
    return toShipmentResponse(await this.shipmentsService.create(dto));
  }

  @Get()
  @ApiOperation({
    summary: 'List non-deleted Shipments: filtered, sorted and paginated',
    description:
      'Root shipments (bookings) and segments (legs) are listed together; use `isRoot` or ' +
      '`parentId` to choose. All filters are optional and combined with AND. `code` and ' +
      '`customerName` match any part of the value, ignoring case. Default: newest first ' +
      '(`createdAt` descending), page 1 of 20. A page past the last one returns no `items`.',
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
    return toShipmentPageResponse(await this.shipmentsService.findAll(query));
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
}
