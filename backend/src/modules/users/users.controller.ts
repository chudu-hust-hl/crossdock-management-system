import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  toUserPageResponse,
  toUserResponse,
  UserPageResponse,
  UserResponse,
} from './dto/user-response.dto';
import { UserRole } from './enums/user-role.enum';
import { type AuthenticatedUser, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid token, or the user is no longer ACTIVE.',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'The caller is not a SYS_ADMIN.',
})
@UseGuards(AuthGuard)
@Roles(UserRole.SYS_ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'The user is ACTIVE. The password is stored only as a bcrypt hash.',
  })
  @ApiCreatedResponse({ type: UserResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid body, e.g. an invalid email, a password shorter than 8 characters, ' +
      'no roles, or a role twice.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The email already belongs to a user.',
  })
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return toUserResponse(await this.usersService.create(dto));
  }

  @Get()
  @ApiOperation({
    summary: 'List non-deleted users: filtered, sorted and paginated',
    description:
      '`email` matches any part of the email, ignoring case. Default: sorted by ' +
      '`fullName` ascending, page 1 of 20.',
  })
  @ApiOkResponse({ type: UserPageResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid query, e.g. an unknown `status` or `sortBy`.',
  })
  async findAll(@Query() query: ListUsersQueryDto): Promise<UserPageResponse> {
    return toUserPageResponse(await this.usersService.findAll(query));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one user by its ULID' })
  @ApiOkResponse({ type: UserResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: '`id` is not a ULID.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such user, or it was deleted.',
  })
  async findOne(@Param() params: UlidParamDto): Promise<UserResponse> {
    return toUserResponse(await this.usersService.findById(params.id));
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Change a user',
    description:
      'Send only the fields to change. `roles` replaces all roles. A new `password` is ' +
      'hashed. You cannot set your own status to LOCKED or INACTIVE, or remove SYS_ADMIN ' +
      'from your own roles.',
  })
  @ApiOkResponse({ type: UserResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid `id` or body (e.g. empty `roles`), or a change that would lock you out.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such user, or it was deleted.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The email already belongs to another user.',
  })
  async update(
    @Param() params: UlidParamDto,
    @Body() dto: UpdateUserDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<UserResponse> {
    return toUserResponse(
      await this.usersService.update(params.id, dto, caller),
    );
  }
}
