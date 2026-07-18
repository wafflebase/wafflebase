import { ConfigService } from '@nestjs/config';
import { AnalyticsProducerService } from './analytics-producer.service';
import { ViewEvent } from './analytics.types';

function make(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new AnalyticsProducerService(config);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const sampleEvent: ViewEvent = {
  document_id: 'doc-1',
  share_link_id: 'link-1',
  session_id: 'session-1',
  visitor_id: 'visitor-1',
  user_id: 'user-1',
  role: 'viewer',
  event_type: 'open',
  target: '',
  doc_type: 'sheet',
  user_agent: 'jest',
  timestamp: '2026-07-17 00:00:00',
};

describe('AnalyticsProducerService', () => {
  it('is disabled when kafka addresses are unset', () => {
    const svc = make({});
    expect(svc.isEnabled()).toBe(false);
  });
  it('is enabled when kafka addresses are set', () => {
    const svc = make({ WAFFLEBASE_KAFKA_ADDRESSES: 'localhost:9092' });
    expect(svc.isEnabled()).toBe(true);
  });
  it('stays disabled when addresses are only whitespace/commas', () => {
    const svc = make({ WAFFLEBASE_KAFKA_ADDRESSES: '  , ,' });
    expect(svc.isEnabled()).toBe(false);
  });
  it('produce() is a no-op that does not throw when disabled', () => {
    const svc = make({});
    expect(() => svc.produce([])).not.toThrow();
  });

  it('recovers after a failed connect instead of failing forever', async () => {
    const svc = make({ WAFFLEBASE_KAFKA_ADDRESSES: 'localhost:9092' });
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect failed'))
      .mockResolvedValueOnce(undefined);
    const send = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { producer: unknown }).producer = { connect, send };

    expect(() => svc.produce([sampleEvent])).not.toThrow();
    await flush();
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    expect(() => svc.produce([sampleEvent])).not.toThrow();
    await flush();
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
