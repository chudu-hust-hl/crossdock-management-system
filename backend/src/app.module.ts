import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import configuration from './config/configuration';
import { validationPipeOptions } from './config/validation.config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { DockTasksModule } from './modules/dock-tasks/dock-tasks.module';
import { ItemsModule } from './modules/items/items.module';
import { LocationsModule } from './modules/locations/locations.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { RoutesModule } from './modules/routes/routes.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    LocationsModule,
    UsersModule,
    ItemsModule,
    ShipmentsModule,
    RoutesModule,
    DockTasksModule,
    MetadataModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
  ],
})
export class AppModule {}
