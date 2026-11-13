import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../users/users.service';
import { AuthenticatedRequest } from './auth.guard';

/** The caller that `AuthGuard` put on the request. Only valid behind that guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new Error('@CurrentUser() needs AuthGuard on the same handler');
    }
    return user;
  },
);
