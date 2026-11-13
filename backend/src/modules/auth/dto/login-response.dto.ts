import { ApiProperty } from '@nestjs/swagger';
import {
  toUserResponse,
  UserResponse,
} from '../../users/dto/user-response.dto';
import { User } from '../../users/schemas/user.schema';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth.constants';

/** Response of a successful `POST /auth/login`. */
export class LoginResponse {
  @ApiProperty({
    description:
      'Signed JWT. Send it as `Authorization: Bearer <accessToken>`.',
  })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: ACCESS_TOKEN_TTL_SECONDS,
    description: 'Seconds until the token expires.',
  })
  expiresIn!: number;

  @ApiProperty({ type: UserResponse })
  user!: UserResponse;
}

export function toLoginResponse(
  accessToken: string,
  user: User,
): LoginResponse {
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: toUserResponse(user),
  };
}
