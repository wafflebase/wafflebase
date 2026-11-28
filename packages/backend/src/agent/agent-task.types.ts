import type { ChannelKind } from '../chat/chat.types';

/**
 * One claimed task, as `GET /api/v1/workspaces/:wid/agent/tasks/next` hands
 * it to a bot's host. Mirrored by the CLI (`packages/cli`); see
 * `docs/tasks/active/20261128-workspace-bots-todo.md` § HTTP contract.
 */
export interface AgentTaskDto {
  id: string;
  channelId: string;
  channelKind: ChannelKind;
  /** Null for a DM. */
  channelName: string | null;
  /** The thread the bot answers in. */
  threadRootId: string;
  triggerMessageId: string;
  invoker: { id: number; username: string };
  /** The trigger message's body; empty once it is deleted. */
  body: string;
  createdAt: string;
}

/** How a host may finish a task. */
export type AgentTaskOutcome = 'done' | 'failed';
