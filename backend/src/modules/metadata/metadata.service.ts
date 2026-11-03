import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BusinessCodeType } from '../../common/enums/business-code-type.enum';
import {
  businessCodePeriod,
  formatBusinessCode,
} from '../../common/utils/business-code.util';
import { MetadataScope } from './enums/metadata-scope.enum';
import { Metadata } from './schemas/metadata.schema';

@Injectable()
export class MetadataService {
  constructor(
    @InjectModel(Metadata.name)
    private readonly metadataModel: Model<Metadata>,
  ) {}

  /**
   * Generates the next business code of a type, e.g. `S-0001-1026`. There is one
   * counter per type and month (key `SHIPMENT-1026`); a new month starts at 1.
   */
  async nextBusinessCode(type: BusinessCodeType, date: Date): Promise<string> {
    const [code] = await this.nextBusinessCodes(type, date, 1);
    return code;
  }

  /**
   * Reserves `count` consecutive codes with one atomic increment, e.g. three item
   * codes `T-0005-1026` … `T-0007-1026`. Returns `[]` for a count of 0.
   */
  async nextBusinessCodes(
    type: BusinessCodeType,
    date: Date,
    count: number,
  ): Promise<string[]> {
    if (count === 0) {
      return [];
    }
    const last = await this.increment(
      MetadataScope.BUSINESS_CODE_COUNTER,
      `${type}-${businessCodePeriod(date)}`,
      count,
    );
    const first = last - count + 1;
    return Array.from({ length: count }, (_, index) =>
      formatBusinessCode(type, first + index, date),
    );
  }

  /**
   * Atomically adds `amount` to a counter and returns the new value. The first call
   * creates the entry. MongoDB retries an upsert that loses a race on the unique
   * `{ scope, key }` index, so concurrent calls get distinct values.
   */
  private async increment(
    scope: MetadataScope,
    key: string,
    amount: number,
  ): Promise<number> {
    const entry = await this.metadataModel
      .findOneAndUpdate(
        { scope, key },
        { $inc: { value: amount } },
        { upsert: true, new: true },
      )
      .lean<Metadata>()
      .exec();
    if (typeof entry?.value !== 'number') {
      throw new Error(`Metadata ${scope}/${key} is not a numeric counter`);
    }
    return entry.value;
  }
}
