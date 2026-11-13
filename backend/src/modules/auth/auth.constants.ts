import { UserRole } from '../users/enums/user-role.enum';

/** A login token is valid for 8 hours after it is issued. */
export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** The one login failure message, so a caller cannot tell which check failed. */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

/** Claims of a login token: the user's ULID and their roles at login. */
export interface AccessTokenPayload {
  sub: string;
  roles: UserRole[];
}
