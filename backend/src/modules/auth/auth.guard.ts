import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserRole } from '../users/enums/user-role.enum';
import { AuthenticatedUser, UsersService } from '../users/users.service';
import { AccessTokenPayload } from './auth.constants';
import { ROLES_KEY } from './roles.decorator';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Protects a handler: `401` without a valid `Authorization: Bearer` token of an
 * ACTIVE, non-deleted user; `403` when none of the user's roles is in `@Roles()`.
 * The roles are read from the database, so a change takes effect at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const user = await this.usersService.findActiveById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    request.user = user;

    const allowed =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (
      allowed.length > 0 &&
      !user.roles.some((role) => allowed.includes(role))
    ) {
      throw new ForbiddenException(
        `Requires one of the roles: ${allowed.join(', ')}`,
      );
    }
    return true;
  }
}
