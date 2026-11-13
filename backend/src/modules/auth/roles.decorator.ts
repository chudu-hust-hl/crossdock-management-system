import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../users/enums/user-role.enum';

export const ROLES_KEY = 'roles';

/** The roles that may call a handler; any one of them is enough. Read by `AuthGuard`. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
