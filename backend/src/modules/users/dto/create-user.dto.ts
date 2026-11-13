import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { UserRole } from '../enums/user-role.enum';
import { MIN_PASSWORD_LENGTH } from '../users.constants';

/** Body of `POST /users`. The new user is `ACTIVE`. */
export class CreateUserDto {
  @ApiProperty({ example: 'Nguyen Van A' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({
    example: 'a.nguyen@example.com',
    description: 'Stored lower-cased; must not belong to another user.',
  })
  @Trim()
  @IsEmail()
  email!: string;

  @ApiProperty({
    minLength: MIN_PASSWORD_LENGTH,
    description: 'Stored only as a bcrypt hash.',
  })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;

  @ApiProperty({
    enum: UserRole,
    enumName: 'UserRole',
    isArray: true,
    example: [UserRole.ADMIN],
    description: 'At least one role, no duplicates.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];
}
