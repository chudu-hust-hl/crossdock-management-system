import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { MetadataModule } from '../metadata/metadata.module';
import { Shipment, ShipmentSchema } from './schemas/shipment.schema';
import { ShipmentCostService } from './shipment-cost.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
    ]),
    LocationsModule,
    ItemsModule,
    MetadataModule,
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, ShipmentCostService],
})
export class ShipmentsModule {}
