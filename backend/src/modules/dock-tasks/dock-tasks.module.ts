import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DockTask, DockTaskSchema } from './schemas/dock-task.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DockTask.name, schema: DockTaskSchema },
    ]),
  ],
})
export class DockTasksModule {}
