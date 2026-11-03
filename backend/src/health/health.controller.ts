import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';

export class HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}

/**
 * Liveness check for the API process only. It does not check MongoDB.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness check of the API process (does not check MongoDB)',
  })
  @ApiOkResponse({ type: HealthResponse })
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
