import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import configuration, { AppConfig } from '../../src/config/configuration';

/**
 * Imports for an integration test that connects to MONGODB_URI but uses its own
 * database. Each test file needs a distinct `dbName` because Jest runs files in
 * parallel and each file drops its database when it finishes.
 */
export function testDatabaseImports(dbName: string) {
  return [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        uri: configService.get('mongodbUri', { infer: true }),
        dbName,
      }),
    }),
  ];
}
