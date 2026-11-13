import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Item } from './schemas/item.schema';

/** A new item with every system-assigned value already decided. */
export type NewItem = CreateItemDto &
  Pick<Item, 'id' | 'itemCode' | 'currentLocationId' | 'currentShipmentId'>;

/** The fields of an Item shown in a shipment list row. */
export type ItemSummary = Pick<
  Item,
  'id' | 'itemCode' | 'itemUnit' | 'weight' | 'weightUnit'
>;

@Injectable()
export class ItemsService {
  constructor(
    @InjectModel(Item.name)
    private readonly itemModel: Model<Item>,
  ) {}

  /**
   * The given barcodes that already belong to an Item. Soft-deleted Items count too,
   * because they keep their unique values.
   */
  async findUsedBarcodes(barcodes: string[]): Promise<string[]> {
    if (barcodes.length === 0) {
      return [];
    }
    const items = await this.itemModel
      .find({ barcode: { $in: barcodes } }, { barcode: 1 })
      .lean<Pick<Item, 'barcode'>[]>()
      .exec();
    return items.map((item) => item.barcode);
  }

  /** Non-deleted Items with these public ids. Missing ids are omitted. */
  async findByIds(ids: string[]): Promise<Item[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.itemModel
      .find({ id: { $in: ids }, deletedAt: null })
      .lean<Item[]>()
      .exec();
  }

  /** Like `findByIds()`, but reads only the fields of `ItemSummary`. */
  async findSummariesByIds(ids: string[]): Promise<ItemSummary[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.itemModel
      .find(
        { id: { $in: ids }, deletedAt: null },
        { _id: 0, id: 1, itemCode: 1, itemUnit: 1, weight: 1, weightUnit: 1 },
      )
      .lean<ItemSummary[]>()
      .exec();
  }

  /**
   * Applies a correction of a booked item: each sent field is written, `description: null`
   * removes the description, and the other fields stay. Returns the updated Item.
   */
  async correct(id: string, changes: UpdateItemDto): Promise<Item> {
    const set: Partial<Item> = {};
    if (typeof changes.description === 'string') {
      set.description = changes.description;
    }
    if (changes.itemUnit !== undefined) {
      set.itemUnit = changes.itemUnit;
    }
    if (changes.weight !== undefined) {
      set.weight = changes.weight;
    }
    if (changes.weightUnit !== undefined) {
      set.weightUnit = changes.weightUnit;
    }
    if (changes.dimensions !== undefined) {
      set.dimensions = changes.dimensions;
    }
    const update: UpdateQuery<Item> = { $set: set };
    if (changes.description === null) {
      update.$unset = { description: 1 };
    }

    const item = await this.itemModel
      .findOneAndUpdate({ id, deletedAt: null }, update, {
        new: true,
        runValidators: true,
      })
      .lean<Item>()
      .exec();
    if (!item) {
      throw new NotFoundException(`Item ${id} not found`);
    }
    return item;
  }

  /**
   * Inserts the items in order. If one fails (e.g. a barcode taken in the meantime),
   * the earlier ones stay inserted; the caller removes them by their ids.
   */
  async createMany(items: NewItem[]): Promise<void> {
    if (items.length > 0) {
      await this.itemModel.insertMany(items, { ordered: true });
    }
  }

  /** Whether any Item (deleted or not) has the Location as its current location. */
  async isAnyAtLocation(locationId: string): Promise<boolean> {
    return (
      (await this.itemModel.exists({ currentLocationId: locationId })) !== null
    );
  }

  /**
   * Rollback only: permanently removes Items that a failed operation created.
   * They never belonged to a saved shipment, so this is not a business deletion
   * (business deletions are soft deletes). Removing them also frees their barcodes.
   */
  async removeCreatedForRollback(ids: string[]): Promise<void> {
    if (ids.length > 0) {
      await this.itemModel.deleteMany({ id: { $in: ids } }).exec();
    }
  }
}
