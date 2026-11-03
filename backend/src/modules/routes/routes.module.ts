import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Route, RouteSchema } from './schemas/route.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Route.name, schema: RouteSchema }]),
  ],
})
export class RoutesModule {}
