import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { LocationsModule } from '../locations/locations.module';
import { MetadataModule } from '../metadata/metadata.module';
import { Route, RouteSchema } from '../routes/schemas/route.schema';
import { Shipment, ShipmentSchema } from '../shipments/schemas/shipment.schema';
import { UsersModule } from '../users/users.module';
import { DockEventsPublisher } from './dock-events.publisher';
import { DockTasksController } from './dock-tasks.controller';
import { DockTasksService } from './dock-tasks.service';
import { RabbitMqService } from './rabbitmq.service';
import { RollupConsumer } from './rollup.consumer';
import { DockTask, DockTaskSchema } from './schemas/dock-task.schema';
import { StatusRollupService } from './status-rollup.service';

/**
 * The dock actions, the RabbitMQ publisher and the rollup consumer. Besides its own
 * `dock_tasks`, it registers Item, Route and Shipment: the actions write items and the
 * rollup writes routes and shipments, each from one service (docs/scanning-flows.md §10).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DockTask.name, schema: DockTaskSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Route.name, schema: RouteSchema },
      { name: Shipment.name, schema: ShipmentSchema },
    ]),
    LocationsModule,
    MetadataModule,
    // For AuthGuard on every dock endpoint.
    UsersModule,
  ],
  controllers: [DockTasksController],
  providers: [
    DockTasksService,
    StatusRollupService,
    RabbitMqService,
    DockEventsPublisher,
    RollupConsumer,
  ],
})
export class DockTasksModule {}
