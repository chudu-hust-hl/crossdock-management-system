import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { UserRole } from '../enums/user-role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { MIN_PASSWORD_LENGTH } from '../users.constants';

/** Validates a property that was sent, including `null`, and skips one that was not. */
const IF_SENT = (_dto: object, value: unknown) => value !== undefined;

/** Body of `PUT /users/:id`. Only the fields that are sent change. */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Nguyen Van A' })
  @ValidateIf(IF_SENT)
  @Trim()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @ApiPropertyOptional({ example: 'a.nguyen@example.com' })
  @ValidateIf(IF_SENT)
  @Trim()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    enumName: 'UserRole',
    isArray: true,
    description:
      'Replaces all roles: at least one, no duplicates. Your own roles must keep SYS_ADMIN.',
  })
  @ValidateIf(IF_SENT)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @ApiPropertyOptional({
    enum: UserStatus,
    enumName: 'UserStatus',
    description: 'You cannot set your own status to LOCKED or INACTIVE.',
  })
  @ValidateIf(IF_SENT)
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    minLength: MIN_PASSWORD_LENGTH,
    description: 'A new password; stored only as a bcrypt hash.',
  })
  @ValidateIf(IF_SENT)
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password?: string;
}
