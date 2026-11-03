import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DimensionUnit } from '../enums/dimension-unit.enum';

/** Embedded in Item. Optional as a whole, but complete when present. */
@Schema({ _id: false })
export class Dimensions {
  @Prop({ type: Number, required: true, min: 0 })
  length!: number;

  @Prop({ type: Number, required: true, min: 0 })
  width!: number;

  @Prop({ type: Number, required: true, min: 0 })
  height!: number;

  @Prop({ type: String, required: true, enum: Object.values(DimensionUnit) })
  unit!: DimensionUnit;
}

export const DimensionsSchema = SchemaFactory.createForClass(Dimensions);
