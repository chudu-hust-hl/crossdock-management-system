/** What a user may do; see `docs/domain-model.md` §4.2. A user holds one or more. */
export enum UserRole {
  SYS_ADMIN = 'SYS_ADMIN',
  ADMIN = 'ADMIN',
  DOCK_MANAGER = 'DOCK_MANAGER',
  DOCK_OPERATOR = 'DOCK_OPERATOR',
}
