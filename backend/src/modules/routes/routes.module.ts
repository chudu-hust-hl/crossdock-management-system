import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { MetadataModule } from '../metadata/metadata.module';
import { RoutesService } from './routes.service';
import { Route, RouteSchema } from './schemas/route.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Route.name, schema: RouteSchema }]),
    LocationsModule,
    ItemsModule,
    MetadataModule,
  ],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
