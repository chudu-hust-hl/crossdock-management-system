import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MetadataService } from './metadata.service';
import { Metadata, MetadataSchema } from './schemas/metadata.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Metadata.name, schema: MetadataSchema },
    ]),
  ],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
