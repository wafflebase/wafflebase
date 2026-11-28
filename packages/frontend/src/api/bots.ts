import { fetchWithAuth } from './auth';
import { assertOk } from './http-error';
import { seg } from './url';

/*
 * Workspace bot members. The types mirror the backend's `BotDto`
 * (docs/tasks/active/20261128-workspace-bots-todo.md § HTTP contract);
 * design: docs/design/chat.md § Bot Members.
 */

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/workspaces`;

/** A machine paired to a bot: one API key per host, never displayed. */
export interface BotHost {
  apiKeyId: string;
  name: string;
  lastUsedAt: string | null;
}

export interface BotDto {
  id: number;
  username: string;
  photo: string | null;
  /** Who may mention the bot into a task. Only "owner" is offered in the MVP. */
  invokers: 'owner' | 'members';
  /** The member who manages it; null once that member's account is deleted. */
  owner: { id: number; username: string } | null;
  createdAt: string;
  /** The last time a host asked the server for work. */
  lastSeenAt: string | null;
  hosts: BotHost[];
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

function botsUrl(workspaceId: string): string {
  return `${BASE}/${seg(workspaceId)}/bots`;
}

/**
 * Fetches the workspace's bots.
 */
export async function fetchBots(workspaceId: string): Promise<BotDto[]> {
  const res = await fetchWithAuth(botsUrl(workspaceId));
  await assertOk(res, "Couldn't load bots");
  return res.json();
}

/**
 * Creates a bot owned by the caller.
 */
export async function createBot(
  workspaceId: string,
  name: string,
): Promise<BotDto> {
  const res = await fetchWithAuth(botsUrl(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await assertOk(res, "Couldn't create the bot");
  return res.json();
}

/**
 * Deletes a bot: its keys are revoked and it leaves the workspace.
 */
export async function deleteBot(
  workspaceId: string,
  botId: number,
): Promise<void> {
  const res = await fetchWithAuth(
    `${botsUrl(workspaceId)}/${seg(String(botId))}`,
    { method: 'DELETE' },
  );
  await assertOk(res, "Couldn't delete the bot");
}

/**
 * Mints a short-lived code a host exchanges for the bot's API key.
 */
export async function createPairingCode(
  workspaceId: string,
  botId: number,
): Promise<PairingCode> {
  const res = await fetchWithAuth(
    `${botsUrl(workspaceId)}/${seg(String(botId))}/pairing-codes`,
    { method: 'POST' },
  );
  await assertOk(res, "Couldn't create a pairing code");
  return res.json();
}
