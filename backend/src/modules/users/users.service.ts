import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcryptjs';
import { FilterQuery, Model } from 'mongoose';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { buildSort, findPage, Page } from '../../common/utils/pagination.util';
import { containsIgnoringCase } from '../../common/utils/text-filter.util';
import { AppConfig, AUTH_SEED_VARIABLES } from '../../config/configuration';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';
import { User } from './schemas/user.schema';
import { PASSWORD_HASH_ROUNDS } from './users.constants';

/** The caller of a protected endpoint, as the auth guard puts it on the request. */
export interface AuthenticatedUser {
  id: string;
  roles: UserRole[];
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Creates the first SYS_ADMIN from AUTH_SEED_* when there is none. */
  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.userModel
      .exists({ roles: UserRole.SYS_ADMIN, deletedAt: null })
      .exec();
    if (existing) {
      return;
    }
    const seed = this.configService.get('authSeed', { infer: true });
    if (!seed) {
      this.logger.warn(
        `No SYS_ADMIN user exists. Set ${Object.values(AUTH_SEED_VARIABLES).join(', ')} ` +
          'and restart to create one.',
      );
      return;
    }
    await this.create({
      fullName: seed.fullName,
      email: seed.email,
      password: seed.password,
      roles: [UserRole.SYS_ADMIN],
    });
    this.logger.log(`Created the first SYS_ADMIN user ${seed.email}.`);
  }

  async create(dto: CreateUserDto): Promise<User> {
    try {
      const user = await this.userModel.create({
        fullName: dto.fullName,
        email: normalizeEmail(dto.email),
        roles: dto.roles,
        status: UserStatus.ACTIVE,
        passwordHash: await hash(dto.password, PASSWORD_HASH_ROUNDS),
      });
      return user.toObject();
    } catch (error) {
      throw duplicateEmailOr(error, dto.email);
    }
  }

  findAll(query: ListUsersQueryDto): Promise<Page<User>> {
    return findPage(
      this.userModel,
      this.buildListFilter(query),
      this.buildListSort(query),
      query,
    );
  }

  /** The MongoDB filter of a user list; soft-deleted users never match. */
  buildListFilter(query: ListUsersQueryDto): FilterQuery<User> {
    return {
      deletedAt: null,
      ...(query.email && { email: containsIgnoringCase(query.email) }),
      ...(query.status && { status: query.status }),
    };
  }

  buildListSort(query: ListUsersQueryDto): Record<string, SortOrder> {
    return buildSort(query.sortBy, query.sortOrder);
  }

  async findById(id: string): Promise<User> {
    const user = await this.userModel
      .findOne({ id, deletedAt: null })
      .lean<User>()
      .exec();
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /**
   * Changes only the fields that are sent. The caller cannot lock or deactivate
   * themselves, or drop SYS_ADMIN from their own roles, so that the last
   * administrator cannot shut themselves out by mistake.
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    caller: AuthenticatedUser,
  ): Promise<User> {
    if (id === caller.id) {
      if (dto.status !== undefined && dto.status !== UserStatus.ACTIVE) {
        throw new BadRequestException(
          `You cannot set your own status to ${dto.status}.`,
        );
      }
      if (dto.roles && !dto.roles.includes(UserRole.SYS_ADMIN)) {
        throw new BadRequestException(
          'You cannot remove SYS_ADMIN from your own roles.',
        );
      }
    }

    const changes: Partial<User> = {};
    if (dto.fullName !== undefined) changes.fullName = dto.fullName;
    if (dto.email !== undefined) changes.email = normalizeEmail(dto.email);
    if (dto.roles !== undefined) changes.roles = dto.roles;
    if (dto.status !== undefined) changes.status = dto.status;
    if (dto.password !== undefined) {
      changes.passwordHash = await hash(dto.password, PASSWORD_HASH_ROUNDS);
    }

    let user: User | null;
    try {
      user = await this.userModel
        .findOneAndUpdate(
          { id, deletedAt: null },
          { $set: changes },
          { new: true, runValidators: true },
        )
        .lean<User>()
        .exec();
    } catch (error) {
      throw duplicateEmailOr(error, dto.email);
    }
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /** For login only: the non-deleted user with this email, including `passwordHash`. */
  findForLogin(email: string): Promise<User | null> {
    return this.userModel
      .findOne({ email: normalizeEmail(email), deletedAt: null })
      .select('+passwordHash')
      .lean<User>()
      .exec();
  }

  async recordLogin(id: string): Promise<User> {
    const user = await this.userModel
      .findOneAndUpdate(
        { id, deletedAt: null },
        { $set: { lastLoginAt: new Date() } },
        { new: true },
      )
      .lean<User>()
      .exec();
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /** The id and current roles of an ACTIVE, non-deleted user; `null` otherwise. */
  findActiveById(id: string): Promise<AuthenticatedUser | null> {
    return this.userModel
      .findOne(
        { id, status: UserStatus.ACTIVE, deletedAt: null },
        { _id: 0, id: 1, roles: 1 },
      )
      .lean<AuthenticatedUser>()
      .exec();
  }
}

/** Emails are stored lower-cased, so every lookup and write uses the same form. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function duplicateEmailOr(error: unknown, email: string | undefined): unknown {
  return isDuplicateKeyError(error)
    ? new ConflictException(
        `Email ${email ? normalizeEmail(email) : ''} is already registered`,
      )
    : error;
}
