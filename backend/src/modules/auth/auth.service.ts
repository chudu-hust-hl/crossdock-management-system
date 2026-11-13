import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { UserStatus } from '../users/enums/user-status.enum';
import { User } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  AccessTokenPayload,
  INVALID_CREDENTIALS_MESSAGE,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';

export interface LoginResult {
  accessToken: string;
  user: User;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * An unknown email, a wrong password, and a user that is not ACTIVE all fail
   * with the same `401`, so a caller cannot find out which emails exist.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findForLogin(dto.email);
    const passwordMatches =
      !!user?.passwordHash && (await compare(dto.password, user.passwordHash));
    if (!user || !passwordMatches || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const loggedIn = await this.usersService.recordLogin(user.id);
    const payload: AccessTokenPayload = {
      sub: loggedIn.id,
      roles: loggedIn.roles,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: loggedIn,
    };
  }
}
