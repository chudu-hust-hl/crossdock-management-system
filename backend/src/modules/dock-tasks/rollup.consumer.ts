import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { parseDockEvent } from './dock-event.message';
import {
  DEAD_LETTER_EXCHANGE,
  EVENTS_EXCHANGE,
  MAX_ROLLUP_ATTEMPTS,
  RETRY_HEADER,
  ROLLUP_FAILED_ROUTING_KEY,
  ROLLUP_QUEUE,
} from './dock-events.constants';
import { DockEventsPublisher } from './dock-events.publisher';
import { RabbitMqService } from './rabbitmq.service';
import { StatusRollupService } from './status-rollup.service';

/**
 * The one consumer of `crossdock.rollup` (prefetch 1). Each message is acked after
 * its rollup succeeded, or after it was handed on: published again with `x-retry`
 * increased by 1, or, after the third failure, to the dead-letter exchange.
 */
@Injectable()
export class RollupConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(RollupConsumer.name);

  constructor(
    private readonly rabbitMq: RabbitMqService,
    private readonly rollup: StatusRollupService,
    private readonly publisher: DockEventsPublisher,
  ) {}

  /** Starts consuming, then sends again the facts a stopped process left without rollup. */
  async onApplicationBootstrap(): Promise<void> {
    const started = await this.rabbitMq.consume(ROLLUP_QUEUE, (message) =>
      this.handle(message),
    );
    if (!started) {
      return;
    }
    try {
      const count = await this.publisher.republishPendingRollups();
      if (count > 0) {
        this.logger.log(`Published ${count} pending rollup message(s) again.`);
      }
    } catch (error) {
      this.logger.error(
        `Replay of pending rollups failed: ${(error as Error).message}`,
      );
    }
  }

  async handle(message: ConsumeMessage): Promise<void> {
    try {
      await this.rollup.apply(parseDockEvent(message.content));
    } catch (error) {
      try {
        await this.retryOrDeadLetter(message, error as Error);
      } catch (publishError) {
        // Not acked: the broker delivers it again once the channel is back.
        this.logger.error(
          `Could not hand on a failed rollup message: ${(publishError as Error).message}`,
        );
        return;
      }
    }
    this.rabbitMq.ack(message);
  }

  private async retryOrDeadLetter(
    message: ConsumeMessage,
    error: Error,
  ): Promise<void> {
    const failures =
      Number(message.properties.headers?.[RETRY_HEADER] ?? 0) + 1;
    const headers = { [RETRY_HEADER]: failures };
    if (failures >= MAX_ROLLUP_ATTEMPTS) {
      this.logger.error(
        `Rollup failed ${failures} times, moved to the dead-letter queue: ${error.message}`,
      );
      await this.rabbitMq.publish(
        DEAD_LETTER_EXCHANGE,
        ROLLUP_FAILED_ROUTING_KEY,
        message.content,
        headers,
      );
      return;
    }
    this.logger.warn(`Rollup failed (attempt ${failures}): ${error.message}`);
    await this.rabbitMq.publish(
      EVENTS_EXCHANGE,
      message.fields.routingKey,
      message.content,
      headers,
    );
  }
}
