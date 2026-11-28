import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { AgentTask } from '@prisma/client';
import { PgBus, sharedPgBus } from '../common/pg-bus';
import { PrismaService } from '../database/prisma.service';
import { AGENT_TASK_NOTIFY_CHANNEL } from '../chat/chat-agent-tasks';
import { ChatMessageService } from '../chat/chat-message.service';
import { ChannelKind, ChatMessageDto } from '../chat/chat.types';
import { AgentTaskDto, AgentTaskOutcome } from './agent-task.types';

/**
 * How long a claim (or the holder's latest reply) holds a task before the
 * next poll may re-queue it.
 */
const LEASE_SECONDS = 10 * 60;
/**
 * How often a waiting long-poll looks again without a NOTIFY: the fallback
 * for a listener that is down or behind a pooler that drops `LISTEN`.
 */
const POLL_MS = 1_000;
/**
 * How often a long-poll still waiting refreshes `botLastSeenAt`, so a host
 * parked on a four-minute wait still reads as listening (Settings shows
 * *Listening* for a bot seen in the last minute).
 */
const TOUCH_MS = 30_000;

const FINISHED = new Set(['done', 'failed']);

/** The task's lease lapsed and another host of the bot claimed it. */
function heldElsewhere(): ConflictException {
  return new ConflictException(
    'Another host of this bot now holds this task: its lease ran out',
  );
}

/**
 * The bot side of agent tasks (`docs/design/agent-runner.md` §§ 2–3, cut to
 * the MVP's long-poll): claim the next task, read its thread, answer in it,
 * finish it. Tasks are created by chat (`ChatAgentTaskTrigger`); this
 * service only hands them out.
 *
 * A wait holds no database connection: every look is one short statement,
 * and between looks the poll sleeps on an in-process waiter that the
 * `agent_task` NOTIFY (payload: the bot's id) or a one-second timer wakes.
 * Every replica listens once, through the process's shared `PgBus`, and
 * fans a wake-up out to its own waiters for that bot.
 */
@Injectable()
export class AgentTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly bus: PgBus;
  private unlisten: (() => Promise<void>) | null = null;
  private stopped = false;
  /** Bot id → the wake-ups of the polls waiting for it on this replica. */
  private readonly waiters = new Map<number, Set<() => void>>();

  /** Overridable in tests. */
  pollMs = POLL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: ChatMessageService,
    /** Tests inject one; otherwise the process-wide bus is shared. */
    @Optional() bus?: PgBus,
  ) {
    this.bus = bus ?? sharedPgBus();
  }

  /**
   * Starts listening here, not in the constructor, so a unit test that
   * builds the provider never touches the network. Never throws: without a
   * listener a poll still finds its task within a second.
   */
  async onModuleInit(): Promise<void> {
    const unlisten = await this.bus.listen(AGENT_TASK_NOTIFY_CHANNEL, {
      onNotify: (payload) => this.receive(payload),
      // NOTIFYs sent while the listener was down are lost; look now.
      onConnect: () => this.wakeAll(),
    });
    if (this.stopped) {
      await unlisten();
      return;
    }
    this.unlisten = unlisten;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const unlisten = this.unlisten;
    this.unlisten = null;
    if (unlisten) await unlisten();
    // Open polls answer `task: null` now instead of holding shutdown.
    this.wakeAll();
  }

  /** Long-polls parked on this replica, for tests. */
  get waiting(): number {
    let n = 0;
    for (const set of this.waiters.values()) n += set.size;
    return n;
  }

  /**
   * 403 unless the caller is a bot. These routes are a bot's work queue: a
   * person's key (or session) has no tasks to claim, and refusing it says so
   * rather than answering an empty queue forever.
   */
  async assertBot(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kind: true },
    });
    if (user?.kind !== 'bot') {
      throw new ForbiddenException('Only a bot can work agent tasks');
    }
  }

  /**
   * Claims this bot's oldest queued task, waiting up to `waitMs` for one to
   * arrive. Every call counts as the bot being seen. Returns null when the
   * wait runs out, when `signal` aborts (the client went away), or at
   * shutdown. Two polls racing for one task cannot both win it: the claim
   * locks the row it picks and skips any row another claim holds. The
   * claim records `apiKeyId` — the host — as the task's holder.
   */
  async next(
    botId: number,
    workspaceId: string,
    waitMs: number,
    signal?: AbortSignal,
    apiKeyId?: string,
  ): Promise<AgentTaskDto | null> {
    await this.touch(botId);
    let touchedAt = Date.now();
    const deadline = Date.now() + waitMs;
    for (;;) {
      if (signal?.aborted) return null;
      const task = await this.claim(botId, workspaceId, apiKeyId ?? null);
      if (task && signal?.aborted) {
        // The caller left while the claim ran: nobody will read this answer,
        // so hand the task back rather than let it sit out its lease.
        await this.release(task.id, apiKeyId ?? null);
        return null;
      }
      if (task) return task;
      const remaining = deadline - Date.now();
      if (remaining <= 0 || signal?.aborted || this.stopped) return null;
      await this.sleep(botId, Math.min(this.pollMs, remaining), signal);
      if (signal?.aborted || this.stopped) return null;
      if (Date.now() - touchedAt >= TOUCH_MS) {
        await this.touch(botId);
        touchedAt = Date.now();
      }
    }
  }

  /**
   * The task's thread, root first and oldest first — read as the bot, so it
   * sees exactly what its membership lets it. A thread longer than one page
   * is its newest page, with the root put back in front: the root is the
   * question, and a host must never lose it.
   */
  async thread(
    botId: number,
    workspaceId: string,
    taskId: string,
  ): Promise<ChatMessageDto[]> {
    const task = await this.ownTask(botId, workspaceId, taskId);
    const rows = await this.messages.page(botId, task.channelId, {
      thread: task.threadRootId,
    });
    if (rows[0]?.id === task.threadRootId) return rows;
    const root = await this.messages.get(botId, task.threadRootId, workspaceId);
    return [root, ...rows];
  }

  /**
   * Answers in the task's thread as the bot, through the ordinary post path
   * — so the bus, the bell and document cards behave as for any message —
   * tagged with the task and the key that sent it. A finished task takes no
   * more replies, and only the host holding the task may answer it: a
   * reply renews that host's lease, or takes back a task its lapsed lease
   * re-queued, but is 409 once another host has claimed it — so a task
   * worked past its lease is never answered twice.
   */
  async reply(
    botId: number,
    workspaceId: string,
    taskId: string,
    body: string,
    apiKeyId?: string,
  ): Promise<ChatMessageDto> {
    const task = await this.ownTask(botId, workspaceId, taskId);
    if (FINISHED.has(task.status)) {
      throw new ConflictException('This task is already finished');
    }
    await this.hold(task.id, apiKeyId ?? null);
    return this.messages.post(botId, task.channelId, {
      body,
      threadRootId: task.threadRootId,
      agentTaskId: task.id,
      apiKeyId,
    });
  }

  /**
   * Finishes the task and releases its lease. Finishing one already
   * finished changes nothing, so a host retrying a lost response is safe.
   * A task another host holds is 409: its lease lapsed and it was handed
   * on, and that host is the one answering it now.
   */
  async complete(
    botId: number,
    workspaceId: string,
    taskId: string,
    status: AgentTaskOutcome,
    apiKeyId?: string,
  ): Promise<void> {
    const task = await this.ownTask(botId, workspaceId, taskId);
    const { count } = await this.prisma.agentTask.updateMany({
      where: {
        id: task.id,
        OR: [
          { status: 'queued' },
          { status: 'claimed', claimedByKeyId: apiKeyId ?? null },
        ],
      },
      data: { status, finishedAt: new Date(), leaseExpiresAt: null },
    });
    if (count > 0) return;
    const now = await this.prisma.agentTask.findUnique({
      where: { id: task.id },
      select: { status: true },
    });
    if (now && !FINISHED.has(now.status)) throw heldElsewhere();
  }

  /**
   * Keeps the task with the host `apiKeyId` for another lease: renews the
   * claim it holds, or re-claims the task when its lapsed lease put it back
   * in the queue. 409 when another host has claimed it meanwhile.
   */
  private async hold(taskId: string, apiKeyId: string | null): Promise<void> {
    const leaseExpiresAt = new Date(Date.now() + LEASE_SECONDS * 1_000);
    const renewed = await this.prisma.agentTask.updateMany({
      where: { id: taskId, status: 'claimed', claimedByKeyId: apiKeyId },
      data: { leaseExpiresAt },
    });
    if (renewed.count > 0) return;
    const retaken = await this.prisma.agentTask.updateMany({
      where: { id: taskId, status: 'queued' },
      data: {
        status: 'claimed',
        claimedAt: new Date(),
        claimedByKeyId: apiKeyId,
        leaseExpiresAt,
      },
    });
    if (retaken.count === 0) throw heldElsewhere();
  }

  /** The task, or 404 — including when it belongs to another bot. */
  private async ownTask(
    botId: number,
    workspaceId: string,
    taskId: string,
  ): Promise<AgentTask> {
    const task = await this.prisma.agentTask.findFirst({
      where: { id: taskId, botId, workspaceId },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async touch(botId: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: botId },
      data: { botLastSeenAt: new Date() },
    });
  }

  /**
   * One look at the queue: first return this bot's expired leases to it (a
   * host that died mid-task gives its work back), then claim the oldest
   * queued task under `FOR UPDATE SKIP LOCKED`, so racing polls each take a
   * different row or none. Times are UTC, as the `timestamp(3)` columns hold
   * them.
   */
  private async release(taskId: string, apiKeyId: string | null) {
    await this.prisma.agentTask.updateMany({
      where: { id: taskId, status: 'claimed', claimedByKeyId: apiKeyId },
      data: {
        status: 'queued',
        claimedAt: null,
        claimedByKeyId: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async claim(
    botId: number,
    workspaceId: string,
    apiKeyId: string | null,
  ): Promise<AgentTaskDto | null> {
    await this.prisma.$executeRaw`
      UPDATE "AgentTask"
      SET "status" = 'queued', "claimedAt" = NULL,
          "claimedByKeyId" = NULL, "leaseExpiresAt" = NULL
      WHERE "botId" = ${botId}
        AND "status" = 'claimed'
        AND "leaseExpiresAt" < (now() AT TIME ZONE 'UTC')`;
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "AgentTask"
      SET "status" = 'claimed',
          "claimedAt" = now() AT TIME ZONE 'UTC',
          "claimedByKeyId" = ${apiKeyId},
          "leaseExpiresAt" =
            (now() AT TIME ZONE 'UTC') + ${LEASE_SECONDS} * interval '1 second'
      WHERE id = (
        SELECT id FROM "AgentTask"
        WHERE "botId" = ${botId}
          AND "workspaceId" = ${workspaceId}
          AND "status" = 'queued'
        ORDER BY "createdAt", id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    if (claimed.length === 0) return null;
    return this.describe(claimed[0].id);
  }

  private async describe(taskId: string): Promise<AgentTaskDto> {
    const task = await this.prisma.agentTask.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        invoker: { select: { id: true, username: true } },
        channel: { select: { kind: true, name: true } },
      },
    });
    const trigger = await this.prisma.chatMessage.findUnique({
      where: { id: task.triggerMessageId },
      select: { body: true, deletedAt: true },
    });
    return {
      id: task.id,
      channelId: task.channelId,
      channelKind: task.channel.kind as ChannelKind,
      channelName: task.channel.name,
      threadRootId: task.threadRootId,
      triggerMessageId: task.triggerMessageId,
      invoker: { id: task.invoker.id, username: task.invoker.username },
      body: !trigger || trigger.deletedAt ? '' : trigger.body,
      createdAt: task.createdAt.toISOString(),
    };
  }

  /**
   * Parks until a wake-up for this bot, `ms`, or `signal` — whichever comes
   * first — and always deregisters, so neither a timeout nor a client that
   * hung up leaves a waiter behind.
   */
  private sleep(
    botId: number,
    ms: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      let set = this.waiters.get(botId);
      if (!set) {
        set = new Set();
        this.waiters.set(botId, set);
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        const current = this.waiters.get(botId);
        current?.delete(done);
        if (current?.size === 0) this.waiters.delete(botId);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
      set.add(done);
    });
  }

  /** A NOTIFY payload is untrusted: anything but a bot id is dropped. */
  private receive(payload: string | undefined): void {
    if (!payload || !/^[1-9]\d{0,15}$/.test(payload)) return;
    const botId = Number(payload);
    for (const wake of [...(this.waiters.get(botId) ?? [])]) wake();
  }

  private wakeAll(): void {
    for (const set of [...this.waiters.values()]) {
      for (const wake of [...set]) wake();
    }
  }
}
