import { validateBody } from '../../../../test/utils/validate-body';
import { UpdateUserDto } from './update-user.dto';

describe('UpdateUserDto', () => {
  it('accepts an empty body and any subset of the fields', async () => {
    expect((await validateBody(UpdateUserDto, {})).errors).toEqual([]);

    const { value, errors } = await validateBody(UpdateUserDto, {
      fullName: ' Tran Thi B ',
      status: 'LOCKED',
      password: 'a new password',
    });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ fullName: 'Tran Thi B', status: 'LOCKED' });
  });

  it('rejects empty roles, null values, and a short password', async () => {
    expect((await validateBody(UpdateUserDto, { roles: [] })).errors).toEqual([
      'roles should not be empty',
    ]);
    expect(
      (await validateBody(UpdateUserDto, { fullName: null, status: null }))
        .errors,
    ).toEqual([
      'fullName should not be empty',
      'fullName must be a string',
      'status must be one of the following values: ACTIVE, INACTIVE, LOCKED',
    ]);
    expect(
      (await validateBody(UpdateUserDto, { password: 'short' })).errors,
    ).toEqual(['password must be longer than or equal to 8 characters']);
  });

  it('does not accept fields that are not user settings', async () => {
    expect(
      (await validateBody(UpdateUserDto, { lastLoginAt: '2026-01-01' })).errors,
    ).toEqual(['property lastLoginAt should not exist']);
  });
});
