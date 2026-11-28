import { ForbiddenException, SetMetadata } from '@nestjs/common';

/** The scope a bot's host key carries instead of `read` / `write`. */
export const AGENT_SCOPE = 'agent';

const AGENT_KEY_ROUTE = 'wafflebase:agent-key-route';

/**
 * Marks a controller whose routes a bot key may call. A bot key is minted by
 * pairing a host (`BotService.pair`) and lives on a machine Wafflebase does
 * not control, so it reaches only the task routes — never documents, files
 * or the rest of `/api/v1` (docs/design/agent-runner.md § 4).
 */
export const AgentKeyRoute = () => SetMetadata(AGENT_KEY_ROUTE, true);

export function isAgentKeyRoute(target: object): boolean {
  return Reflect.getMetadata(AGENT_KEY_ROUTE, target) === true;
}

/** Refuses a bot key anywhere but an `@AgentKeyRoute()` controller. */
export function assertAgentKeyScope(
  user: { isApiKey?: boolean; scopes?: string[] } | undefined,
  controller: object,
): void {
  if (!user?.isApiKey || !user.scopes?.includes(AGENT_SCOPE)) return;
  if (isAgentKeyRoute(controller)) return;
  throw new ForbiddenException('A bot key works only on the agent task routes');
}
