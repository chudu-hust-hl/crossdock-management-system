import { ValidationPipeOptions } from '@nestjs/common';

/** Options of the global `ValidationPipe` registered in `AppModule`. */
export const validationPipeOptions: ValidationPipeOptions = {
  // Only properties declared on the DTO are accepted. Unknown or server-controlled
  // properties (`_id`, `status`, `deliveryInfos`, ...) make the request fail with 400
  // instead of being silently dropped.
  whitelist: true,
  forbidNonWhitelisted: true,
  // Controllers receive DTO class instances, with `@Trim()` already applied.
  transform: true,
};
