import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { generateUlid } from '../../src/common/utils/ulid.util';
import { UserRole } from '../../src/modules/users/enums/user-role.enum';
import { User } from '../../src/modules/users/schemas/user.schema';

/**
 * `configuration()` requires JWT_SECRET. Integration tests sign their own tokens,
 * so a fixed test-only value is enough when the environment has none.
 */
export function useTestJwtSecret(): void {
  process.env.JWT_SECRET ||= 'test-only-jwt-secret';
}

/**
 * Creates an ACTIVE user with these roles in the test database and signs a login
 * token for it, as `POST /auth/login` would. The module must import `AuthModule`.
 */
export async function tokenFor(
  moduleRef: TestingModule,
  ...roles: UserRole[]
): Promise<string> {
  const userModel = moduleRef.get<Model<User>>(getModelToken(User.name));
  const user = await userModel.create({
    fullName: `Test ${roles.join(' ')}`,
    email: `${generateUlid().toLowerCase()}@test.local`,
    roles,
  });
  return moduleRef.get(JwtService).signAsync({ sub: user.id, roles });
}

/** `Authorization` header value for a token. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
