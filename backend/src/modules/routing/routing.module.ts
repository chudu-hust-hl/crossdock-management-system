import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocationsModule } from '../locations/locations.module';
import { Shipment, ShipmentSchema } from '../shipments/schemas/shipment.schema';
import { RoutingService } from './routing.service';
import { Province, ProvinceSchema } from './schemas/province.schema';

/**
 * Routing updates a shipment's delivery infos after booking. The Shipment model
 * is registered here, as well as in ShipmentsModule, so this module can save
 * that change without importing ShipmentsModule (that import would be a cycle).
 * Both registrations use the same schema on the one application connection.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
      { name: Province.name, schema: ProvinceSchema },
    ]),
    LocationsModule,
  ],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
