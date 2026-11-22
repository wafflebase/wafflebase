import type { WebhookDetail, WebhookInput } from "@/api/webhooks";
import type { Folder } from "@/types/documents";
import {
  DEFAULT_PRESET,
  WEBHOOK_PRESETS,
  eventsFromSelection,
  selectionFromEvents,
} from "./webhook-events";

/**
 * The webhook form's state and its pure conversions, apart from the
 * components so they can be tested (and hot-reloaded) on their own.
 */

/** Everything the create dialog and the detail page's config form edit. */
export interface WebhookFormValues {
  name: string;
  url: string;
  selected: Set<string>;
  /** Off = every folder; on with an empty list is refused at submit. */
  limitFolders: boolean;
  folderIds: string[];
}

export function emptyFormValues(): WebhookFormValues {
  return {
    name: "",
    url: "",
    selected: new Set(
      WEBHOOK_PRESETS.find((p) => p.id === DEFAULT_PRESET)!.events,
    ),
    limitFolders: false,
    folderIds: [],
  };
}

export function formValuesFrom(webhook: WebhookDetail): WebhookFormValues {
  return {
    name: webhook.name,
    url: webhook.url,
    selected: selectionFromEvents(webhook.events),
    limitFolders: webhook.folderIds.length > 0,
    folderIds: webhook.folderIds,
  };
}

/**
 * The request body for the values, keeping `documentTypes` from `base`: the
 * UI does not edit it, so an update must not quietly clear one set through
 * the CLI.
 */
export function toWebhookInput(
  values: WebhookFormValues,
  base?: Pick<WebhookDetail, "documentTypes">,
): WebhookInput {
  return {
    name: values.name.trim(),
    url: values.url.trim(),
    events: eventsFromSelection(values.selected),
    documentTypes: base?.documentTypes ?? [],
    folderIds: values.limitFolders ? values.folderIds : [],
  };
}

/** Why the form cannot be submitted yet, or null when it can. */
export function formProblem(values: WebhookFormValues): string | null {
  if (!values.name.trim()) return "Give the webhook a name.";
  if (!values.url.trim()) return "Enter the URL to send events to.";
  if (values.selected.size === 0) return "Pick at least one event.";
  if (values.limitFolders && values.folderIds.length === 0) {
    return "Pick at least one folder, or send events from every folder.";
  }
  return null;
}

/**
 * The quick, local half of "validated as typed against the SSRF rules": the
 * scheme and shape. Address checks need DNS, so the server does those on
 * save and the form shows what it says.
 */
export function localUrlProblem(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That isn't a complete URL. It should look like https://example.com/hooks/wafflebase.";
  }
  if (parsed.protocol === "http:") {
    return "Webhook URLs must use https://. Your server administrator can allow http:// with WAFFLEBASE_WEBHOOK_ALLOW_HTTP=true.";
  }
  if (parsed.protocol !== "https:") {
    return "Webhook URLs must use https://.";
  }
  return null;
}

/** Folders as "Parent / Child" paths, sorted, so same-named ones differ. */
export function folderPaths(
  folders: Folder[],
): Array<{ id: string; path: string }> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (folder: Folder): string => {
    const parts = [folder.name];
    const seen = new Set([folder.id]);
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    // `seen` guards a cycle the server should never produce.
    while (parent && !seen.has(parent.id)) {
      parts.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  return folders
    .map((f) => ({ id: f.id, path: pathOf(f) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The re-enable banner's "recover since" choices. */
export type RecoverChoice = "disabled" | "failing" | "none";

/** The `recoverSince` the server takes for a banner choice. */
export function recoverSinceFor(
  choice: RecoverChoice,
  webhook: Pick<WebhookDetail, "disabledAt" | "failingSince">,
): string | null {
  if (choice === "disabled") return webhook.disabledAt;
  if (choice === "failing") return webhook.failingSince;
  return null;
}
