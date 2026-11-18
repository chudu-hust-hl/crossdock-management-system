import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DockTask,
  DockTaskSchema,
} from '../dock-tasks/schemas/dock-task.schema';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { MetadataModule } from '../metadata/metadata.module';
import { Shipment, ShipmentSchema } from '../shipments/schemas/shipment.schema';
import { UsersModule } from '../users/users.module';
import { DocksController } from './docks.controller';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { Route, RouteSchema } from './schemas/route.schema';

/**
 * Route assignment and the route API. Shipment and DockTask are registered here
 * so this module does not import ShipmentsModule or DockTasksModule (each of
 * those already reaches Route).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Route.name, schema: RouteSchema },
      { name: Shipment.name, schema: ShipmentSchema },
      { name: DockTask.name, schema: DockTaskSchema },
    ]),
    LocationsModule,
    ItemsModule,
    MetadataModule,
    // For AuthGuard on POST /routes/:id/shipments.
    UsersModule,
  ],
  controllers: [RoutesController, DocksController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
