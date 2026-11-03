import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('registers ValidationPipe as the global pipe', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Provider[];

    expect(providers).toContainEqual({
      provide: APP_PIPE,
      useValue: expect.any(ValidationPipe) as unknown,
    });
  });
});
