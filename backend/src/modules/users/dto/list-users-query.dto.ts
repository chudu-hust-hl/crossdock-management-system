import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SortOrder } from '../../../common/enums/sort-order.enum';
import { UserSortField } from '../enums/user-sort-field.enum';
import { UserStatus } from '../enums/user-status.enum';

/** Filters, sorting and paging of `GET /users`, e.g. `?status=LOCKED&email=example`. */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Part of the email, ignoring case.',
    example: 'example.com',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  email?: string;

  @ApiPropertyOptional({ enum: UserStatus, enumName: 'UserStatus' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    enum: UserSortField,
    enumName: 'UserSortField',
    default: UserSortField.FULL_NAME,
  })
  @IsOptional()
  @IsEnum(UserSortField)
  sortBy: UserSortField = UserSortField.FULL_NAME;

  @ApiPropertyOptional({
    enum: SortOrder,
    enumName: 'SortOrder',
    default: SortOrder.ASC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
