import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AppConfig } from '../config/configuration';

const logger = new Logger('Database');

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        uri: configService.get('mongodbUri', { infer: true }),
        onConnectionCreate: (connection: Connection) => {
          connection.on('connected', () => logger.log('MongoDB connected'));
          connection.on('disconnected', () =>
            logger.warn('MongoDB disconnected'),
          );
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
