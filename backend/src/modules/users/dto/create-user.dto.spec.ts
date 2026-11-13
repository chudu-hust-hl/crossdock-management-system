import { validateBody } from '../../../../test/utils/validate-body';
import { CreateUserDto } from './create-user.dto';

function body(overrides: Record<string, unknown> = {}) {
  return {
    fullName: ' Nguyen Van A ',
    email: ' a.nguyen@example.com ',
    password: '12345678',
    roles: ['ADMIN', 'DOCK_MANAGER'],
    ...overrides,
  };
}

describe('CreateUserDto', () => {
  it('accepts a valid body and trims the name and email', async () => {
    const { value, errors } = await validateBody(CreateUserDto, body());

    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      fullName: 'Nguyen Van A',
      email: 'a.nguyen@example.com',
      roles: ['ADMIN', 'DOCK_MANAGER'],
    });
  });

  it('requires a password of at least 8 characters', async () => {
    expect(
      (await validateBody(CreateUserDto, body({ password: '1234567' }))).errors,
    ).toEqual(['password must be longer than or equal to 8 characters']);
  });

  it('requires at least one known role and no duplicates', async () => {
    expect(
      (await validateBody(CreateUserDto, body({ roles: [] }))).errors,
    ).toEqual(['roles should not be empty']);
    expect(
      (await validateBody(CreateUserDto, body({ roles: ['ADMIN', 'ADMIN'] })))
        .errors,
    ).toEqual(["All roles's elements must be unique"]);
    expect(
      (
        await validateBody(
          CreateUserDto,
          body({ roles: ['OPERATIONS_MANAGER'] }),
        )
      ).errors,
    ).toEqual([
      'each value in roles must be one of the following values: SYS_ADMIN, ADMIN, DOCK_MANAGER, DOCK_OPERATOR',
    ]);
  });

  it('rejects an invalid email and fields the server controls', async () => {
    expect(
      (await validateBody(CreateUserDto, body({ email: 'not-an-email' })))
        .errors,
    ).toEqual(['email must be an email']);
    expect(
      (
        await validateBody(
          CreateUserDto,
          body({ status: 'LOCKED', passwordHash: 'x' }),
        )
      ).errors,
    ).toEqual([
      'property status should not exist',
      'property passwordHash should not exist',
    ]);
  });
});
