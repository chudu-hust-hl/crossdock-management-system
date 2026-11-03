import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UlidParamDto } from '../../common/dto/ulid-param.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import {
  LocationPageResponse,
  LocationResponse,
  toLocationPageResponse,
  toLocationResponse,
} from './dto/location-response.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /** `201 Created` for a new Location; `200 OK` when an existing store is reused. */
  @Post()
  @ApiOperation({
    summary: 'Create a Location, or reuse a matching STORE',
    description:
      'A `STORE` whose `name`, `contactName` and `address.postalCode` match an existing store ' +
      '(ignoring case and extra whitespace) is not created again: the existing store is returned unchanged.',
  })
  @ApiCreatedResponse({
    type: LocationResponse,
    description: 'A new Location was created.',
  })
  @ApiOkResponse({
    type: LocationResponse,
    description: 'An existing matching STORE was reused.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid body, e.g. a STORE without `contactName`.',
  })
  async create(
    @Body() dto: CreateLocationDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LocationResponse> {
    const { location, created } = await this.locationsService.create(dto);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return toLocationResponse(location);
  }

  @Get()
  @ApiOperation({
    summary: 'List non-deleted Locations: filtered, sorted and paginated',
    description:
      'All filters are optional and combined with AND. `name` and `contactName` match any part ' +
      'of the value, ignoring case. Default: sorted by `name` ascending, page 1 of 20. ' +
      'A page past the last one returns no `items`.',
  })
  @ApiOkResponse({ type: LocationPageResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query, e.g. an unknown `type`, `status` or `sortBy`, a blank `name`, ' +
      '`limit` above 100, or an unknown parameter.',
  })
  async findAll(
    @Query() query: ListLocationsQueryDto,
  ): Promise<LocationPageResponse> {
    return toLocationPageResponse(await this.locationsService.findAll(query));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one Location by its ULID' })
  @ApiOkResponse({ type: LocationResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`id` is not a ULID.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such Location, or it was deleted.',
  })
  async findOne(@Param() params: UlidParamDto): Promise<LocationResponse> {
    return toLocationResponse(await this.locationsService.findById(params.id));
  }
}
