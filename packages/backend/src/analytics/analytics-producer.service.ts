import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { ViewEvent } from './analytics.types';

/**
 * Fire-and-forget Kafka producer for view events. Ports Yorkie's
 * server/backend/messaging/kafka.go (async writer). A failed produce must
 * never break a document view — errors are logged and swallowed. When
 * WAFFLEBASE_KAFKA_ADDRESSES is unset the service is a no-op (local dev).
 */
@Injectable()
export class AnalyticsProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsProducerService.name);
  private readonly topic: string;
  private producer: Producer | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.topic =
      this.config.get<string>('WAFFLEBASE_KAFKA_TOPIC') ??
      'wafflebase-view-events';
    const brokers = (
      this.config.get<string>('WAFFLEBASE_KAFKA_ADDRESSES') ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Only enable with at least one real broker — a whitespace-only value or
    // trailing comma must not leave the producer "enabled" with no brokers
    // (which would silently drop accepted events).
    if (brokers.length > 0) {
      const kafka = new Kafka({ clientId: 'wafflebase-backend', brokers });
      this.producer = kafka.producer();
    }
  }

  isEnabled(): boolean {
    return this.producer !== null;
  }

  /** Enrich-and-send is done by the caller; this only ships to Kafka. */
  produce(events: ViewEvent[]): void {
    if (!this.producer || events.length === 0) return;
    void this.send(events).catch((err) => {
      this.logger.warn(`view-event produce failed: ${String(err)}`);
    });
  }

  private async send(events: ViewEvent[]): Promise<void> {
    if (!this.producer) return;
    if (!this.connecting) {
      this.connecting = this.producer.connect().catch((err) => {
        this.connecting = null;
        throw err;
      });
    }
    await this.connecting;
    await this.producer.send({
      topic: this.topic,
      messages: events.map((e) => ({ value: JSON.stringify(e) })),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect().catch(() => undefined);
    }
  }
}
