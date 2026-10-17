// ============================================================
// src/events/EventEmitter.ts
// RabbitMQ event emitter + webhook dispatcher
// ============================================================

import amqp, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { EventType } from '../types/index.js';
import { CustodyVaultEvent } from './EventTypes.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class CustodyEventEmitter {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnecting = false;
  private isWebhookConsumerRunning = false;
  private isMock = false;

  private readonly exchangeName = config.RABBITMQ_EXCHANGE;
  private readonly dlxExchangeName = `${config.RABBITMQ_EXCHANGE}.dlx`;
  private readonly webhookQueueName = config.RABBITMQ_WEBHOOK_QUEUE;
  private readonly dlqQueueName = `${config.RABBITMQ_WEBHOOK_QUEUE}.dlq`;

  /**
   * Connect to RabbitMQ broker and initialize durable topic exchange, webhook queue, and DLQ.
   */
  public async connect(url?: string): Promise<void> {
    if (this.connection && this.channel) {
      return;
    }

    if (this.isConnecting) {
      logger.warn('[EventEmitter] Connection attempt already in progress.');
      return;
    }

    this.isConnecting = true;
    const amqpUrl = url ?? config.RABBITMQ_URL;

    try {
      logger.info(`[EventEmitter] Connecting to RabbitMQ at ${amqpUrl.replace(/\/\/.*@/, '//<credentials>@')}...`);
      this.connection = await amqp.connect(amqpUrl);

      this.connection.on('error', (err: Error) => {
        logger.error('[EventEmitter] RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        logger.warn('[EventEmitter] RabbitMQ connection closed.');
        this.connection = null;
        this.channel = null;
        this.isWebhookConsumerRunning = false;
      });

      this.channel = await this.connection.createChannel();

      // Ensure prefetch limit to avoid flooding consumer
      await this.channel.prefetch(10);

      // 1. Setup Dead Letter Exchange and Queue
      await this.channel.assertExchange(this.dlxExchangeName, 'direct', { durable: true });
      await this.channel.assertQueue(this.dlqQueueName, { durable: true });
      await this.channel.bindQueue(this.dlqQueueName, this.dlxExchangeName, this.dlqQueueName);

      // 2. Setup Primary Topic Exchange
      await this.channel.assertExchange(this.exchangeName, 'topic', { durable: true });

      // 3. Setup Primary Webhook Queue with Dead Letter routing
      await this.channel.assertQueue(this.webhookQueueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.dlxExchangeName,
          'x-dead-letter-routing-key': this.dlqQueueName,
        },
      });

      // Bind all custody vault events to webhook queue
      await this.channel.bindQueue(this.webhookQueueName, this.exchangeName, 'custody.event.#');

      logger.info('[EventEmitter] RabbitMQ connected and topologies asserted successfully.');
    } catch (error) {
      if (process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test') {
        logger.warn('[EventEmitter] RabbitMQ broker not reachable on port 5672. Operating in local mock event bus mode.');
        this.isMock = true;
        this.connection = null;
        this.channel = null;
        return;
      }
      logger.error('[EventEmitter] Failed to connect to RabbitMQ:', error);
      this.connection = null;
      this.channel = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Gracefully close channel and connection.
   */
  public async disconnect(): Promise<void> {
    try {
      this.isWebhookConsumerRunning = false;
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      logger.info('[EventEmitter] RabbitMQ disconnected successfully.');
    } catch (error) {
      logger.error('[EventEmitter] Error during RabbitMQ disconnect:', error);
      throw error;
    }
  }

  /**
   * Sign payload data using HMAC SHA-256.
   */
  private generateHmacSignature(payload: string): string {
    const secret = config.HMAC_SECRET;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Create signed envelope and publish event to the RabbitMQ exchange with persistent delivery mode.
   */
  public async emit<T>(eventType: EventType, data: T): Promise<void> {
    if (this.isMock) {
      logger.info(`[EventEmitter:Mock] Emitted event [${eventType}]`, { data });
      return;
    }

    if (!this.channel) {
      logger.warn(`[EventEmitter] Channel not initialized. Attempting auto-reconnect for event [${eventType}]...`);
      try {
        await this.connect();
      } catch (connErr) {
        logger.error(`[EventEmitter] Cannot emit event [${eventType}] — RabbitMQ unavailable.`, connErr);
        throw connErr;
      }
    }

    if (!this.channel) {
      throw new Error(`[EventEmitter] Channel unavailable after connect. Event [${eventType}] dropped.`);
    }

    const eventId = uuidv4();
    const timestamp = new Date().toISOString();
    const payloadString = JSON.stringify(data);
    const signature = this.generateHmacSignature(`${timestamp}.${eventId}.${eventType}.${payloadString}`);

    const envelope: CustodyVaultEvent<T> = {
      eventId,
      eventType,
      timestamp,
      signature: `sha256=${signature}`,
      data,
    };

    const routingKey = `custody.event.${eventType.toLowerCase().replace(/_/g, '.')}`;
    const buffer = Buffer.from(JSON.stringify(envelope));

    const published = this.channel.publish(this.exchangeName, routingKey, buffer, {
      persistent: true,
      messageId: eventId,
      timestamp: Date.now(),
      contentType: 'application/json',
      type: eventType,
    });

    if (!published) {
      logger.warn(`[EventEmitter] RabbitMQ write buffer full. Event [${eventType}] queued in memory.`);
    } else {
      logger.info(`[EventEmitter] Published event [${eventType}] ID: ${eventId} to key: ${routingKey}`);
    }
  }

  /**
   * Start consumer on the webhook queue to deliver HTTP POST callbacks to AfricaCrypto.
   */
  public async startWebhookDelivery(): Promise<void> {
    if (this.isMock) {
      logger.info('[EventEmitter:Mock] Webhook delivery skipped (mock mode — RabbitMQ not connected).');
      return;
    }

    if (!this.channel) {
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('[EventEmitter] Cannot start webhook delivery: channel unavailable.');
    }

    if (this.isWebhookConsumerRunning) {
      logger.warn('[EventEmitter] Webhook consumer already running.');
      return;
    }

    this.isWebhookConsumerRunning = true;
    logger.info(`[EventEmitter] Starting webhook delivery consumer on queue '${this.webhookQueueName}'...`);

    await this.channel.consume(
      this.webhookQueueName,
      async (msg: ConsumeMessage | null) => {
        if (!msg) {
          return;
        }

        const rawContent = msg.content.toString();
        let envelope: CustodyVaultEvent;

        try {
          envelope = JSON.parse(rawContent) as CustodyVaultEvent;
        } catch (parseError) {
          logger.error('[EventEmitter] Unparseable message format. Routing to DLQ directly.', {
            error: parseError,
            rawContent,
          });
          this.channel?.nack(msg, false, false);
          return;
        }

        const webhookUrl = config.WEBHOOK_AFRICACRYPTO_URL;
        if (!webhookUrl) {
          logger.error('[EventEmitter] No webhook URL configured. Nacking message to requeue.', {
            eventId: envelope.eventId,
          });
          this.channel?.nack(msg, false, true);
          return;
        }

        const maxRetries = config.WEBHOOK_MAX_RETRIES;
        const initialDelayMs = config.WEBHOOK_RETRY_DELAY_MS;

        let attempt = 0;
        let delivered = false;

        while (attempt < maxRetries && !delivered) {
          attempt++;
          try {
            logger.info(
              `[EventEmitter] Delivering webhook attempt ${attempt}/${maxRetries} for event [${envelope.eventType}] ID: ${envelope.eventId}`
            );

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Vault-Event-Id': envelope.eventId,
                'X-Vault-Event-Type': envelope.eventType,
                'X-Vault-Signature': envelope.signature,
                'X-Vault-Timestamp': envelope.timestamp,
              },
              body: rawContent,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              delivered = true;
              logger.info(
                `[EventEmitter] Successfully delivered event [${envelope.eventType}] ID: ${envelope.eventId}. HTTP Status: ${response.status}`
              );
              this.channel?.ack(msg);
              return;
            } else {
              const responseText = await response.text().catch(() => '');
              logger.warn(
                `[EventEmitter] Webhook delivery HTTP status ${response.status} on attempt ${attempt}: ${responseText}`
              );
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.warn(`[EventEmitter] Webhook delivery failure on attempt ${attempt}/${maxRetries}: ${errorMessage}`);
          }

          if (!delivered && attempt < maxRetries) {
            const delay = initialDelayMs * Math.pow(2, attempt - 1);
            logger.info(`[EventEmitter] Backing off for ${delay}ms before retry ${attempt + 1}...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!delivered) {
          logger.error(
            `[EventEmitter] Max delivery attempts (${maxRetries}) exhausted for event [${envelope.eventType}] ID: ${envelope.eventId}. Moving to DLQ.`
          );
          this.channel?.nack(msg, false, false);
        }
      },
      { noAck: false }
    );
  }
}

export const eventEmitter = new CustodyEventEmitter();
