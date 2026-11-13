import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);
  const port = configService.get('port', { infer: true });

  app.enableCors({ origin: configService.get('corsOrigin', { infer: true }) });
  setupSwagger(app);

  await app.listen(port);
  Logger.log(
    `API listening on port ${port} (${configService.get('nodeEnv', { infer: true })})`,
    'Bootstrap',
  );
  Logger.log(
    `Swagger UI: http://localhost:${port}/${SWAGGER_PATH}`,
    'Bootstrap',
  );
}

void bootstrap();
