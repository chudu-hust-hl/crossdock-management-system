import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    healthController = moduleRef.get(HealthController);
  });

  it('reports that the API process is running', () => {
    expect(healthController.check()).toEqual({ status: 'ok' });
  });
});
