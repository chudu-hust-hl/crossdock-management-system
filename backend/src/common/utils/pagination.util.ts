import { FilterQuery, Model } from 'mongoose';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { SortOrder } from '../enums/sort-order.enum';

/** One page of a list, with the number of matches on all pages. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Sorts by `field`, then by the ULID `id`, so that records with equal values
 * keep a stable order and no record appears on two pages.
 */
export function buildSort(
  field: string,
  order: SortOrder,
): Record<string, SortOrder> {
  return { [field]: order, id: order };
}

/** Reads one page of `filter` (sorted) and counts all documents matching it. */
export async function findPage<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  sort: Record<string, SortOrder>,
  { page, limit }: PaginationQueryDto,
): Promise<Page<T>> {
  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<T[]>()
      .exec(),
    model.countDocuments(filter).exec(),
  ]);
  return { items, page, limit, total };
}
