import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Swagger UI is served at `/docs`, the raw OpenAPI JSON at `/docs-json`. */
export const SWAGGER_PATH = 'docs';

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Cross-dock Management API')
    .setDescription(
      'Logistics and cross-dock operations. Every resource is identified by its public ULID `id`.',
    )
    .setVersion('0.0.1')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(SWAGGER_PATH, app, createSwaggerDocument(app));
}
