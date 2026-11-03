import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Embedded in Location; not a collection. Only `addressLine1` and `postalCode` are
 * required: `postalCode` is part of the Location reuse rule (docs/business-workflows.md).
 */
@Schema({ _id: false })
export class Address {
  @Prop({ type: String, required: true, trim: true })
  addressLine1!: string;

  @Prop({ type: String, trim: true })
  addressLine2?: string;

  @Prop({ type: String, trim: true })
  ward?: string;

  @Prop({ type: String, trim: true })
  district?: string;

  @Prop({ type: String, trim: true })
  city?: string;

  @Prop({ type: String, trim: true })
  province?: string;

  @Prop({ type: String, required: true, trim: true })
  postalCode!: string;

  @Prop({ type: String, trim: true })
  country?: string;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
