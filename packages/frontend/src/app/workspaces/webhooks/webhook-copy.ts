import type {
  MemberRemovalImpact,
  WebhookDetail,
  WebhookDisabledReason,
  WebhookTestResult,
  WebhookUrlErrorCode,
} from "@/api/webhooks";

/**
 * The words the webhook screens say about failures, kept apart from the
 * components so they can be tested as sentences.
 *
 * "Errors that teach" (docs/design/webhooks.md): the first failure most
 * self-hosters hit is an internal n8n address, and "Invalid URL" leaves them
 * nowhere. Each refusal names what was wrong and, where an operator can
 * change it, the setting that would.
 */
export function urlErrorMessage(
  code: WebhookUrlErrorCode | null,
  address?: string | null,
  fallback?: string | null,
): string {
  switch (code) {
    case "private_address":
      return `This address resolves to a private network${
        address ? ` (${address})` : ""
      }. Your server administrator can allow it by adding the range to WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS.`;
    case "scheme_not_allowed":
      return "Webhook URLs must use https://. Your server administrator can allow http:// with WAFFLEBASE_WEBHOOK_ALLOW_HTTP=true.";
    case "invalid_url":
      return "That isn't a complete URL. It should look like https://example.com/hooks/wafflebase.";
    case "dns_failed":
      return "The host name couldn't be resolved. Check it for typos, or that it is reachable from this server.";
    case "redirect":
      return "The endpoint answered with a redirect. Webhooks never follow redirects, so use the final URL.";
    case "timeout":
      return "The endpoint didn't answer within 10 seconds.";
    case "too_large":
      return "The endpoint's response was too large.";
    case "network":
      return "Couldn't connect to the endpoint.";
    default:
      return fallback || "Couldn't reach the endpoint.";
  }
}

/** One line for a test ping or a delivery attempt: what came back. */
export function testResultLine(result: WebhookTestResult): string {
  const latency =
    result.durationMs === null ? "" : ` in ${formatDuration(result.durationMs)}`;
  if (result.status !== null) {
    return result.ok
      ? `Your endpoint answered ${result.status}${latency}.`
      : `Your endpoint answered ${result.status}${latency}. Only a 2xx response counts as delivered.`;
  }
  return urlErrorMessage(result.errorCode, null, result.error);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Status badge text for a row: "Active", or "Off" with the reason. */
export function statusLabel(
  status: "active" | "disabled",
  reason: WebhookDisabledReason | null,
): string {
  if (status === "active") return "Active";
  switch (reason) {
    case "failing":
      return "Off · failing";
    case "gone":
      return "Off · endpoint gone";
    case "creator_removed":
      return "Off · creator left";
    case "manual":
      return "Off";
    default:
      return "Off";
  }
}

/**
 * The disabled banner: why, in words. Names the last response when there is
 * one, since that is what the owner goes to fix.
 */
export function disabledExplanation(
  webhook: Pick<
    WebhookDetail,
    "disabledReason" | "lastDeliveryStatus" | "createdBy"
  >,
): string {
  const last =
    webhook.lastDeliveryStatus !== null
      ? ` Last response: ${webhook.lastDeliveryStatus}.`
      : "";
  switch (webhook.disabledReason) {
    case "failing":
      return `Turned off automatically after 3 days of failed deliveries.${last}`;
    case "gone":
      return "Turned off because the endpoint answered 410 Gone, which means it no longer wants deliveries.";
    case "creator_removed":
      return "Turned off because the person who created it left the workspace or is no longer an owner. Re-enabling it makes you its owner.";
    case "manual":
      return "Turned off by an owner. Nothing is sent while it is off.";
    default:
      return "This webhook is off. Nothing is sent while it is off.";
  }
}

/** "23 h", "40 min": how long until a rotation overlap ends. */
export function timeUntil(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "a moment";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

/** "3 min ago" for the list and log, or the date once it is old. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** The sentences the dialog lists; empty when nothing else is affected. */
export function removalConsequences(
  impact: MemberRemovalImpact,
  isSelf: boolean,
): string[] {
  const who = isSelf ? "you" : "they";
  const lines: string[] = [];
  if (impact.privateChannelsDeleted > 0) {
    const n = impact.privateChannelsDeleted;
    lines.push(
      `${n === 1 ? "1 private channel" : `${n} private channels`} only ${who} belonged to will be deleted, messages included.`,
    );
  }
  if (impact.webhooksDisabled > 0) {
    const n = impact.webhooksDisabled;
    lines.push(
      `${n === 1 ? "1 webhook" : `${n} webhooks`} ${who} created will be turned off.`,
    );
  }
  const bots = impact.botsRemoved ?? 0;
  if (bots > 0) {
    lines.push(
      `${bots === 1 ? "1 bot" : `${bots} bots`} ${who} own will be deleted, and every host connected to ${bots === 1 ? "it" : "them"} disconnected.`,
    );
  }
  return lines;
}
