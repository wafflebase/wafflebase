import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/api/webhooks";

/**
 * The event picker's vocabulary: use-case presets over the grouped full list
 * (docs/design/webhooks.md § User experience). A preset only pre-checks a
 * bundle; the checkboxes underneath stay the source of truth.
 */

export type WebhookPresetId = "channel" | "backup" | "members" | "everything";

export interface WebhookPreset {
  id: WebhookPresetId;
  label: string;
  description: string;
  events: readonly WebhookEventType[];
}

export const WEBHOOK_PRESETS: readonly WebhookPreset[] = [
  {
    id: "channel",
    label: "Post to a team channel",
    description: "New, moved and trashed documents. Pair it with a folder.",
    events: ["document.created", "document.moved", "document.trashed"],
  },
  {
    id: "backup",
    label: "Back up or index documents",
    description: "Content changes, renames, and the trash lifecycle.",
    events: [
      "document.content_updated",
      "document.renamed",
      "document.trashed",
      "document.restored",
      "document.deleted",
    ],
  },
  {
    id: "members",
    label: "Sync members",
    description: "People joining and leaving the workspace.",
    events: ["member.joined", "member.removed"],
  },
  {
    id: "everything",
    label: "Everything",
    description: "Every event, including ones added later.",
    events: WEBHOOK_EVENT_TYPES,
  },
];

export const DEFAULT_PRESET: WebhookPresetId = "everything";

export interface WebhookEventOption {
  type: WebhookEventType;
  label: string;
  /** Shown under the label; only events with a surprise carry one. */
  hint?: string;
}

/**
 * `content_updated` carries its latency in the picker: it is coalesced, so
 * without this it reads as broken the first time someone types and waits.
 */
export const CONTENT_UPDATED_HINT =
  "Arrives about a minute after editing pauses, at most 5 minutes.";

export const WEBHOOK_EVENT_GROUPS: ReadonlyArray<{
  label: string;
  events: readonly WebhookEventOption[];
}> = [
  {
    label: "Documents",
    events: [
      { type: "document.created", label: "Created" },
      { type: "document.renamed", label: "Renamed" },
      { type: "document.moved", label: "Moved" },
      {
        type: "document.content_updated",
        label: "Content updated",
        hint: CONTENT_UPDATED_HINT,
      },
      { type: "document.trashed", label: "Moved to trash" },
      { type: "document.restored", label: "Restored" },
      { type: "document.deleted", label: "Deleted permanently" },
    ],
  },
  {
    label: "Folders",
    events: [
      { type: "folder.created", label: "Created" },
      { type: "folder.updated", label: "Renamed or moved" },
      { type: "folder.deleted", label: "Deleted" },
    ],
  },
  {
    label: "Members",
    events: [
      { type: "member.joined", label: "Joined" },
      { type: "member.removed", label: "Removed" },
    ],
  },
];

/** The preset whose bundle is exactly `selected`, or null for a custom mix. */
export function presetFor(
  selected: ReadonlySet<string>,
): WebhookPresetId | null {
  for (const preset of WEBHOOK_PRESETS) {
    if (
      preset.events.length === selected.size &&
      preset.events.every((e) => selected.has(e))
    ) {
      return preset.id;
    }
  }
  return null;
}

/**
 * The stored `events` filter → the checked set. Empty means every event,
 * so it checks them all.
 */
export function selectionFromEvents(events: readonly string[]): Set<string> {
  return new Set(events.length === 0 ? WEBHOOK_EVENT_TYPES : events);
}

/**
 * The checked set → the stored `events` filter. Every box checked is sent as
 * the empty list, so an "Everything" webhook also receives event types added
 * after it was created — the audit case wants exactly that.
 */
export function eventsFromSelection(selected: ReadonlySet<string>): string[] {
  if (WEBHOOK_EVENT_TYPES.every((e) => selected.has(e))) return [];
  return WEBHOOK_EVENT_TYPES.filter((e) => selected.has(e));
}

/** A short, human label for a stored `events` filter, for list rows. */
export function describeEvents(events: readonly string[]): string {
  if (events.length === 0) return "All events";
  const preset = presetFor(new Set(events));
  if (preset) return WEBHOOK_PRESETS.find((p) => p.id === preset)!.label;
  return events.length === 1 ? "1 event" : `${events.length} events`;
}
