import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

function isOrdered(from: Date | null, to: Date | null): boolean {
  return from == null || to == null || from <= to;
}

/**
 * Embedded `{ from, to }` used for every `appointment` and `actualWindow`.
 * Both ends stay `null` until known. The order check is declared on both paths
 * because Mongoose only validates modified paths when an existing document is saved;
 * it does not run on update queries unless `runValidators` is enabled.
 */
@Schema({ _id: false })
export class TimeWindow {
  @Prop({
    type: Date,
    default: null,
    validate: {
      validator: function (this: TimeWindow, from: Date | null) {
        return isOrdered(from, this.to);
      },
      message: '`from` must not be later than `to`',
    },
  })
  from!: Date | null;

  @Prop({
    type: Date,
    default: null,
    validate: {
      validator: function (this: TimeWindow, to: Date | null) {
        return isOrdered(this.from, to);
      },
      message: '`to` must not be earlier than `from`',
    },
  })
  to!: Date | null;
}

export const TimeWindowSchema = SchemaFactory.createForClass(TimeWindow);
