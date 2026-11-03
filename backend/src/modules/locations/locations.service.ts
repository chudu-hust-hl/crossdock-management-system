import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { buildSort, findPage, Page } from '../../common/utils/pagination.util';
import { containsIgnoringCase } from '../../common/utils/text-filter.util';
import { AddressDto } from './dto/address.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { LocationCandidateDto } from './dto/location-candidate.dto';
import { LocationType } from './enums/location-type.enum';
import {
  LOCATION_IDENTITY_COLLATION,
  normalizeIdentityText,
} from './location-identity';
import { Location } from './schemas/location.schema';

/** The Location that was found or created, and whether it is new. */
export interface LocationResolution {
  location: Location;
  created: boolean;
}

/** The fields needed to find or create a `STORE`. */
type StoreInput = Omit<CreateLocationDto, 'type' | 'contactName'> & {
  contactName: string;
};

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name)
    private readonly locationModel: Model<Location>,
  ) {}

  /**
   * Manual creation by an administrator. A `STORE` goes through the reuse rule,
   * so an existing matching store is returned instead of creating a duplicate.
   */
  async create(dto: CreateLocationDto): Promise<LocationResolution> {
    if (dto.type === LocationType.STORE) {
      if (!dto.contactName) {
        throw new BadRequestException('contactName is required for a STORE');
      }
      return this.findOrCreateStore({ ...dto, contactName: dto.contactName });
    }

    const location = await this.locationModel.create({
      ...dto,
      name: normalizeIdentityText(dto.name),
      contactName:
        dto.contactName === undefined
          ? undefined
          : normalizeIdentityText(dto.contactName),
      address: normalizeAddress(dto.address),
    });
    return { location: location.toObject(), created: true };
  }

  /**
   * Resolves Location details supplied with a shipment (or a future import) to a
   * `STORE`: reuses the matching store, or creates one when there is no match.
   */
  resolveCandidate(
    candidate: LocationCandidateDto,
  ): Promise<LocationResolution> {
    return this.findOrCreateStore(candidate);
  }

  findAll(query: ListLocationsQueryDto): Promise<Page<Location>> {
    return findPage(
      this.locationModel,
      this.buildListFilter(query),
      this.buildListSort(query),
      query,
    );
  }

  /** The MongoDB filter of a Location list; soft-deleted Locations never match. */
  buildListFilter(query: ListLocationsQueryDto): FilterQuery<Location> {
    return {
      deletedAt: null,
      ...(query.type && { type: query.type }),
      ...(query.status && { status: query.status }),
      ...(query.name && { name: containsIgnoringCase(query.name) }),
      ...(query.contactName && {
        contactName: containsIgnoringCase(query.contactName),
      }),
      ...(query.postalCode && {
        'address.postalCode': normalizeIdentityText(query.postalCode),
      }),
    };
  }

  buildListSort(query: ListLocationsQueryDto): Record<string, SortOrder> {
    return buildSort(query.sortBy, query.sortOrder);
  }

  async findById(id: string): Promise<Location> {
    const location = await this.locationModel
      .findOne({ id, deletedAt: null })
      .lean<Location>()
      .exec();
    if (!location) {
      throw new NotFoundException(`Location ${id} not found`);
    }
    return location;
  }

  /**
   * Rollback only: permanently removes a Location that a failed operation created.
   * The caller must first check that nothing references it. This is not a business
   * deletion (those are soft deletes).
   */
  async removeCreatedForRollback(id: string): Promise<void> {
    await this.locationModel.deleteOne({ id }).exec();
  }

  /**
   * A matching store is returned as it is: its contact and address details are
   * never overwritten by the new input.
   */
  private async findOrCreateStore(
    input: StoreInput,
  ): Promise<LocationResolution> {
    const store = {
      ...input,
      type: LocationType.STORE,
      name: normalizeIdentityText(input.name),
      contactName: normalizeIdentityText(input.contactName),
      address: normalizeAddress(input.address),
    };

    const existing = await this.findStore(store);
    if (existing) {
      return { location: existing, created: false };
    }

    try {
      const location = await this.locationModel.create(store);
      return { location: location.toObject(), created: true };
    } catch (error) {
      // Another request created the same store between the lookup and the
      // insert; the unique `store_identity` index rejected this one.
      const winner = isDuplicateKeyError(error)
        ? await this.findStore(store)
        : null;
      if (winner) {
        return { location: winner, created: false };
      }
      throw error;
    }
  }

  private findStore(store: StoreInput): Promise<Location | null> {
    return this.locationModel
      .findOne({
        type: LocationType.STORE,
        deletedAt: null,
        name: store.name,
        contactName: store.contactName,
        'address.postalCode': store.address.postalCode,
      })
      .collation(LOCATION_IDENTITY_COLLATION)
      .lean<Location>()
      .exec();
  }
}

function normalizeAddress(address: AddressDto): AddressDto {
  return { ...address, postalCode: normalizeIdentityText(address.postalCode) };
}
