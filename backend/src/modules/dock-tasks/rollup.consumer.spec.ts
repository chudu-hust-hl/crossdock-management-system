import { ConsumeMessage } from 'amqplib';
import { DockEventsPublisher } from './dock-events.publisher';
import { RabbitMqService } from './rabbitmq.service';
import { RollupConsumer } from './rollup.consumer';
import { StatusRollupService } from './status-rollup.service';

const BODY = Buffer.from(
  JSON.stringify({
    eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    occurredAt: '2026-11-13T07:30:00.000Z',
    type: 'SCAN_INBOUND',
    routeId: '01M4GVJ9TMCR0DTRTXG3JHTPHS',
    locationId: '01M4GVJ9TMCR0DTRTXG3JHTPHT',
    itemIds: ['01M4GVJ9TMCR0DTRTXG3JHTPHV'],
    taskIds: ['01M4GVJ9TMCR0DTRTXG3JHTPHW'],
  }),
);

function message(retries?: number): ConsumeMessage {
  return {
    content: BODY,
    fields: { routingKey: 'dock.scan.completed' },
    properties: {
      headers: retries === undefined ? {} : { 'x-retry': retries },
    },
  } as unknown as ConsumeMessage;
}

describe('RollupConsumer', () => {
  const rabbitMq = { publish: jest.fn(), ack: jest.fn() };
  const rollup = { apply: jest.fn() };
  const consumer = new RollupConsumer(
    rabbitMq as unknown as RabbitMqService,
    rollup as unknown as StatusRollupService,
    {} as DockEventsPublisher,
  );

  beforeEach(() => jest.resetAllMocks());

  it('runs the rollup with the message fields, then acks', async () => {
    const original = message();
    await consumer.handle(original);

    expect(rollup.apply).toHaveBeenCalledWith({
      type: 'SCAN_INBOUND',
      routeId: '01M4GVJ9TMCR0DTRTXG3JHTPHS',
      locationId: '01M4GVJ9TMCR0DTRTXG3JHTPHT',
      itemIds: ['01M4GVJ9TMCR0DTRTXG3JHTPHV'],
      taskIds: ['01M4GVJ9TMCR0DTRTXG3JHTPHW'],
    });
    expect(rabbitMq.publish).not.toHaveBeenCalled();
    expect(rabbitMq.ack).toHaveBeenCalledWith(original);
  });

  it('publishes a failed message again with x-retry + 1 and acks the original', async () => {
    rollup.apply.mockRejectedValue(new Error('MongoDB is down'));
    const original = message(1);
    await consumer.handle(original);

    expect(rabbitMq.publish).toHaveBeenCalledWith(
      'crossdock.events',
      'dock.scan.completed',
      BODY,
      { 'x-retry': 2 },
    );
    expect(rabbitMq.ack).toHaveBeenCalledWith(original);
  });

  it('moves the message to the dead-letter exchange after the third failure', async () => {
    rollup.apply.mockRejectedValue(new Error('Route not found'));
    await consumer.handle(message(2));

    expect(rabbitMq.publish).toHaveBeenCalledWith(
      'crossdock.dlx',
      'crossdock.rollup.failed',
      BODY,
      { 'x-retry': 3 },
    );
    expect(rabbitMq.ack).toHaveBeenCalledTimes(1);
  });

  it('does not ack when the failed message cannot be handed on', async () => {
    rollup.apply.mockRejectedValue(new Error('MongoDB is down'));
    rabbitMq.publish.mockRejectedValue(new Error('Channel closed'));
    await consumer.handle(message());

    expect(rabbitMq.ack).not.toHaveBeenCalled();
  });
});
