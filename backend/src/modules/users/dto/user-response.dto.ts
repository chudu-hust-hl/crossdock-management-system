import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { Page } from '../../../common/utils/pagination.util';
import { UserRole } from '../enums/user-role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { User } from '../schemas/user.schema';

/** A user as returned by the API: no `passwordHash`, `_id`, `__v` or `deletedAt`. */
export class UserResponse {
  @ApiProperty({
    description: 'Public ULID.',
    example: '01M5HJ2FXJ9RYWMT6YT7YX9KH7',
  })
  id!: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName!: string;

  @ApiProperty({ example: 'a.nguyen@example.com' })
  email!: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole', isArray: true })
  roles!: UserRole[];

  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' })
  status!: UserStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Absent until the first login.',
  })
  lastLoginAt?: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** One page of `GET /users`. */
export class UserPageResponse extends PageResponse {
  @ApiProperty({ type: [UserResponse] })
  items!: UserResponse[];
}

export function toUserPageResponse(page: Page<User>): UserPageResponse {
  return { ...page, items: page.items.map(toUserResponse) };
}

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    roles: user.roles,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
