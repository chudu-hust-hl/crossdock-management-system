import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateItemDto } from './dto/create-item.dto';
import { Item } from './schemas/item.schema';

/** A new item with every system-assigned value already decided. */
export type NewItem = CreateItemDto &
  Pick<Item, 'id' | 'itemCode' | 'currentLocationId' | 'currentShipmentId'>;

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
