import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Read-only view of the existing `provinces` reference data
 * (docs/business-workflows.md §5). Routing never writes this collection.
 * `id` is the province code (`01` is Hà Nội), not a ULID. This is not a domain
 * entity: there is no `deletedAt`, and the schema creates no indexes.
 */
@Schema({ _id: false })
export class ProvinceName {
  @Prop({ type: String })
  local?: string;

  @Prop({ type: String })
  en?: string;

  @Prop({ type: String })
  slug?: string;
}

export const ProvinceNameSchema = SchemaFactory.createForClass(ProvinceName);

@Schema({ collection: 'provinces', timestamps: false, autoIndex: false })
export class Province {
  /** Province code, for example `01`. Not a ULID. */
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: ProvinceNameSchema, required: true })
  name!: ProvinceName;
}

export const ProvinceSchema = SchemaFactory.createForClass(Province);
