import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  ChannelModel,
  ConfirmChannel,
  connect,
  ConsumeMessage,
} from 'amqplib';
import { AppConfig } from '../../config/configuration';
import {
  DEAD_LETTER_EXCHANGE,
  EVENTS_EXCHANGE,
  ROLLUP_DEAD_LETTER_QUEUE,
  ROLLUP_FAILED_ROUTING_KEY,
  ROLLUP_QUEUE,
  ROUTING_KEYS,
} from './dock-events.constants';

/**
 * The only class that uses amqplib. When RABBITMQ_URL is set it connects once at
 * startup and declares the topology of docs/scanning-flows.md §8. Without the URL,
 * or when the broker cannot be reached, the API still runs and `publish()` answers 503.
 */
@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private readonly url: string | null;
  private connection: ChannelModel | null = null;
  /** Publishes and waits for the broker to confirm each message. */
  private publishChannel: ConfirmChannel | null = null;
  /** Consumes `crossdock.rollup` with prefetch 1. */
  private consumeChannel: Channel | null = null;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.url = configService.get('rabbitmqUrl', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.url) {
      this.logger.warn(
        'RABBITMQ_URL is not set: the dock actions answer 503 and no rollup runs.',
      );
      return;
    }
    try {
      this.connection = await connect(this.url);
      this.connection.on('error', (error: Error) =>
        this.logger.error(`RabbitMQ connection error: ${error.message}`),
      );
      this.connection.on('close', () => {
        this.logger.error('RabbitMQ connection closed.');
        this.forgetConnection();
      });
      this.publishChannel = await this.connection.createConfirmChannel();
      this.consumeChannel = await this.connection.createChannel();
      await this.declareTopology(this.publishChannel);
      await this.consumeChannel.prefetch(1);
      this.logger.log('Connected to RabbitMQ (RABBITMQ_URL).');
    } catch (error) {
      this.logger.error(
        `Cannot connect to RabbitMQ at RABBITMQ_URL: ${(error as Error).message}`,
      );
      await this.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  isConnected(): boolean {
    return this.publishChannel !== null;
  }

  /** Throws the 503 of a dock action when nothing can be published. */
  assertConnected(): void {
    if (this.isConnected()) {
      return;
    }
    throw new ServiceUnavailableException(
      this.url
        ? 'RabbitMQ is not reachable at RABBITMQ_URL; dock events cannot be published. Start the broker and restart the API.'
        : 'RABBITMQ_URL is not set; dock events cannot be published.',
    );
  }

  /** Publishes a persistent JSON message and waits until the broker has stored it. */
  async publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    headers: Record<string, unknown> = {},
  ): Promise<void> {
    this.assertConnected();
    this.publishChannel!.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      headers,
    });
    await this.publishChannel!.waitForConfirms();
  }

  /** Starts the consumer of a queue. Returns false when not connected. */
  async consume(
    queue: string,
    onMessage: (message: ConsumeMessage) => Promise<void>,
  ): Promise<boolean> {
    if (!this.consumeChannel) {
      return false;
    }
    await this.consumeChannel.consume(queue, (message) => {
      if (message) {
        void onMessage(message);
      }
    });
    return true;
  }

  ack(message: ConsumeMessage): void {
    this.consumeChannel?.ack(message);
  }

  /** The exchanges, queues and bindings of docs/scanning-flows.md §8, all durable. */
  private async declareTopology(channel: Channel): Promise<void> {
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(ROLLUP_QUEUE, {
      durable: true,
      deadLetterExchange: DEAD_LETTER_EXCHANGE,
      deadLetterRoutingKey: ROLLUP_FAILED_ROUTING_KEY,
    });
    for (const routingKey of Object.values(ROUTING_KEYS)) {
      await channel.bindQueue(ROLLUP_QUEUE, EVENTS_EXCHANGE, routingKey);
    }
    await channel.assertQueue(ROLLUP_DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(
      ROLLUP_DEAD_LETTER_QUEUE,
      DEAD_LETTER_EXCHANGE,
      ROLLUP_FAILED_ROUTING_KEY,
    );
  }

  private async close(): Promise<void> {
    const connection = this.connection;
    this.forgetConnection();
    if (connection) {
      await connection.close().catch(() => undefined);
    }
  }

  private forgetConnection(): void {
    this.connection = null;
    this.publishChannel = null;
    this.consumeChannel = null;
  }
}
