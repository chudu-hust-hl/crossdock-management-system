import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { generateUlid, ulidValidator } from '../../../common/utils/ulid.util';
import { UserRole } from '../enums/user-role.enum';
import { UserStatus } from '../enums/user-status.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: generateUlid,
    validate: ulidValidator,
  })
  id!: string;

  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  /** Stored trimmed and lower-cased, so the unique index is case-insensitive in practice. */
  @Prop({
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  })
  email!: string;

  /**
   * bcrypt hash of the login password; never a plaintext password.
   * Excluded from query results unless selected with `.select('+passwordHash')`.
   */
  @Prop({ type: String, select: false })
  passwordHash?: string;

  @Prop({
    type: [{ type: String, enum: Object.values(UserRole) }],
    required: true,
    default: [],
  })
  roles!: UserRole[];

  @Prop({
    type: String,
    required: true,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  /** Soft delete: `null` while the document exists. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
