import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import type { AuthenticatedUser } from '../users/users.service';
import { DockTasksService } from './dock-tasks.service';
import {
  DockActionResponse,
  DockTaskRowResponse,
  toDockActionResponse,
  toDockTaskResponse,
} from './dto/dock-task-response.dto';
import { ListDockTasksQueryDto } from './dto/list-dock-tasks-query.dto';
import { MarkMissingDto } from './dto/mark-missing.dto';
import { RouteActionDto } from './dto/route-action.dto';
import { ScanDto, ScanFormDto } from './dto/scan.dto';
import type { UploadedPhoto } from './dto/scan.dto';

/** Largest accepted scan photo: 10 MB. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const UNAUTHORIZED = {
  type: ErrorResponseDto,
  description: 'Missing or invalid token, or the user is no longer ACTIVE.',
};
const NOT_PUBLISHED = {
  type: ErrorResponseDto,
  description:
    'RABBITMQ_URL is not set, or RabbitMQ is not reachable. Nothing was written.',
};
const ACTION_RESULT =
  'The completed tasks and the next PENDING tasks. The route and the shipments are ' +
  'updated afterwards by the rollup consumer.';

@ApiTags('dock-tasks')
@ApiBearerAuth()
@Controller('dock-tasks')
@UseGuards(AuthGuard)
export class DockTasksController {
  constructor(private readonly dockTasksService: DockTasksService) {}

  @Post('pickup')
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_MANAGER)
  @ApiOperation({
    summary: 'Confirm pickup at the store for a whole store–dock route',
    description:
      'For every expected item still CREATED: a COMPLETED SCAN_OUTBOUND task at the store ' +
      '(`metadata.reason: MANUAL_PICKUP`), the item IN_TRANSIT on the leg, and a PENDING ' +
      'SCAN_INBOUND task at the dock. Publishes `route.pickup.confirmed`.',
  })
  @ApiCreatedResponse({ type: DockActionResponse, description: ACTION_RESULT })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`routeId` is not a ULID.',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'The caller is neither a SYS_ADMIN nor a DOCK_MANAGER.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such route.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The route is not PLANNED, does not start at a store, or has no item left to pick up.',
  })
  @ApiServiceUnavailableResponse(NOT_PUBLISHED)
  async confirmPickup(
    @Body() dto: RouteActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DockActionResponse> {
    return toDockActionResponse(
      await this.dockTasksService.confirmPickup(dto, user),
    );
  }

  @Post('scan')
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_OPERATOR)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ScanFormDto })
  @ApiOperation({
    summary: 'Scan an item in or out at a dock, with a proof photo',
    description:
      'The barcode must match one PENDING SCAN_INBOUND or SCAN_OUTBOUND task of this route at ' +
      'this Location. The photo is saved under POD_DIR and its path stored as ' +
      '`metadata.podPath`. Scan-in sets the item AT_DOCK here and creates the scan-out task ' +
      'of the next leg; scan-out sets it IN_TRANSIT on the outbound leg and, toward a dock, ' +
      'creates the scan-in task there. Publishes `dock.scan.completed`.',
  })
  @ApiCreatedResponse({ type: DockActionResponse, description: ACTION_RESULT })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid fields, or the photo is missing or not an image/jpeg or image/png file.',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'The caller is neither a SYS_ADMIN nor a DOCK_OPERATOR.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No PENDING scan task for this barcode at this Location on this route.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The item was marked missing.',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'The photo is larger than 10 MB.',
  })
  @ApiServiceUnavailableResponse(NOT_PUBLISHED)
  async scan(
    @Body() dto: ScanDto,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DockActionResponse> {
    return toDockActionResponse(
      await this.dockTasksService.scan(dto, photo, user),
    );
  }

  @Post('missing')
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_MANAGER)
  @ApiOperation({
    summary: 'Mark one expected item missing at a stop of a route',
    description:
      'Completes the open scan task of the item there, if any, and writes a COMPLETED ' +
      'EXCEPTION task (`errorCode: MISSING`, `errorMessage` the note). The item becomes ' +
      'EXCEPTION and is no longer expected. Publishes `dock.item.missing`.',
  })
  @ApiCreatedResponse({ type: DockActionResponse, description: ACTION_RESULT })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'An id is not a ULID, or the note is empty.',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'The caller is neither a SYS_ADMIN nor a DOCK_MANAGER.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such route, the Location is not one of its stops, or the item is not on it.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The item is already EXCEPTION or DELIVERED.',
  })
  @ApiServiceUnavailableResponse(NOT_PUBLISHED)
  async markMissing(
    @Body() dto: MarkMissingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DockActionResponse> {
    return toDockActionResponse(
      await this.dockTasksService.markMissing(dto, user),
    );
  }

  @Post('delivery')
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_MANAGER)
  @ApiOperation({
    summary: 'Confirm delivery at the store for a whole dock–store route',
    description:
      'Every expected item must already be IN_TRANSIT on this leg (scanned out of the last ' +
      'dock). Each gets a COMPLETED SCAN_INBOUND task at the store ' +
      '(`metadata.reason: MANUAL_DELIVERY`) and becomes DELIVERED there. Publishes ' +
      '`route.delivery.confirmed`.',
  })
  @ApiCreatedResponse({ type: DockActionResponse, description: ACTION_RESULT })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`routeId` is not a ULID.',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'The caller is neither a SYS_ADMIN nor a DOCK_MANAGER.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such route.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The route does not end at a store, or an expected item is not IN_TRANSIT on it yet.',
  })
  @ApiServiceUnavailableResponse(NOT_PUBLISHED)
  async confirmDelivery(
    @Body() dto: RouteActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DockActionResponse> {
    return toDockActionResponse(
      await this.dockTasksService.confirmDelivery(dto, user),
    );
  }

  @Get()
  @Roles(UserRole.SYS_ADMIN, UserRole.DOCK_MANAGER, UserRole.DOCK_OPERATOR)
  @ApiOperation({
    summary: 'List the dock tasks of one route at one Location',
    description:
      'Non-deleted tasks with the given status (default PENDING), oldest first, each with ' +
      'the `itemCode` and `barcode` from the route snapshot.',
  })
  @ApiOkResponse({ type: [DockTaskRowResponse] })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      '`locationId` or `routeId` is missing or not a ULID, or `status` is unknown.',
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      'The caller is not a SYS_ADMIN, a DOCK_MANAGER or a DOCK_OPERATOR.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such route.',
  })
  async findTasks(
    @Query() query: ListDockTasksQueryDto,
  ): Promise<DockTaskRowResponse[]> {
    const rows = await this.dockTasksService.findTasks(query);
    return rows.map((row) => ({
      ...toDockTaskResponse(row.task),
      itemCode: row.itemCode,
      barcode: row.barcode,
    }));
  }
}
