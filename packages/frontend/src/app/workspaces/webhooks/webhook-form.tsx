import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFolders } from "@/api/folders";
import type { Folder } from "@/types/documents";
import { cn } from "@/lib/utils";
import {
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_PRESETS,
  presetFor,
} from "./webhook-events";
import {
  folderPaths,
  localUrlProblem,
  type WebhookFormValues,
} from "./webhook-form-values";

/**
 * Name, URL, events and folder filter. Controlled: the parent owns the
 * values, the save button and the server's answer.
 */
export function WebhookFormFields({
  workspaceId,
  values,
  onChange,
  urlError,
  idPrefix = "webhook",
}: {
  workspaceId: string;
  values: WebhookFormValues;
  onChange: (next: WebhookFormValues) => void;
  /** The server's refusal of the URL, which outranks the local check. */
  urlError?: string | null;
  idPrefix?: string;
}) {
  const set = (patch: Partial<WebhookFormValues>) =>
    onChange({ ...values, ...patch });
  const activePreset = presetFor(values.selected);
  // http:// is only a warning here: an operator may have allowed it, and only
  // the server knows. The server's answer replaces it once it comes.
  const shownUrlError = urlError ?? localUrlProblem(values.url);

  const toggleEvent = (type: string, on: boolean) => {
    const next = new Set(values.selected);
    if (on) next.add(type);
    else next.delete(type);
    set({ selected: next });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Zapier → weekly report"
          maxLength={100}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-url`}>URL</Label>
        <Input
          id={`${idPrefix}-url`}
          value={values.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={
            shownUrlError ? `${idPrefix}-url-error` : undefined
          }
        />
        {shownUrlError && (
          <p
            id={`${idPrefix}-url-error`}
            className={cn(
              "text-sm [overflow-wrap:anywhere]",
              urlError ? "text-destructive" : "text-warning",
            )}
          >
            {shownUrlError}
          </p>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Events</legend>
        <div
          role="radiogroup"
          aria-label="What is this webhook for?"
          className="grid gap-2 sm:grid-cols-2"
        >
          {WEBHOOK_PRESETS.map((preset) => {
            const on = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ selected: new Set(preset.events) })}
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on
                    ? "border-transparent bg-selected text-selected-foreground"
                    : "hover:bg-accent",
                )}
              >
                <span className="block text-sm font-medium">
                  {preset.label}
                </span>
                <span
                  className={cn(
                    "block text-xs",
                    on ? "text-selected-foreground" : "text-muted-foreground",
                  )}
                >
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
          {WEBHOOK_EVENT_GROUPS.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.events.map((event) => {
                const id = `${idPrefix}-event-${event.type}`;
                return (
                  <div key={event.type} className="flex items-start gap-2">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={values.selected.has(event.type)}
                      onCheckedChange={(c) => toggleEvent(event.type, c === true)}
                      aria-describedby={event.hint ? `${id}-hint` : undefined}
                    />
                    <div className="min-w-0">
                      <Label htmlFor={id} className="font-normal">
                        {event.label}
                      </Label>
                      {event.hint && (
                        <p
                          id={`${id}-hint`}
                          className="text-xs text-muted-foreground"
                        >
                          {event.hint}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </fieldset>

      <FolderFilter
        workspaceId={workspaceId}
        idPrefix={idPrefix}
        limit={values.limitFolders}
        folderIds={values.folderIds}
        onChange={(limitFolders, folderIds) =>
          set({ limitFolders, folderIds })
        }
      />
    </div>
  );
}

/**
 * The optional folder filter. Folder events and member events have no
 * folder, so the filter narrows document events only — said in the hint so
 * nobody expects it to silence `member.joined`.
 */
function FolderFilter({
  workspaceId,
  idPrefix,
  limit,
  folderIds,
  onChange,
}: {
  workspaceId: string;
  idPrefix: string;
  limit: boolean;
  folderIds: string[];
  onChange: (limit: boolean, folderIds: string[]) => void;
}) {
  const { data: folders = [], isLoading } = useQuery<Folder[]>({
    queryKey: ["workspaces", workspaceId, "folders"],
    queryFn: () => fetchFolders(workspaceId),
    enabled: limit,
  });
  const options = useMemo(() => folderPaths(folders), [folders]);
  const chosen = new Set(folderIds);
  const toggleId = `${idPrefix}-limit-folders`;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Checkbox
          id={toggleId}
          className="mt-0.5"
          checked={limit}
          onCheckedChange={(c) => onChange(c === true, folderIds)}
        />
        <div>
          <Label htmlFor={toggleId} className="font-normal">
            Only documents in some folders
          </Label>
          <p className="text-xs text-muted-foreground">
            Applies to document events. A document counts when it sits
            directly in a chosen folder.
          </p>
        </div>
      </div>
      {limit && (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading folders…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This workspace has no folders yet.
            </p>
          ) : (
            options.map((folder) => {
              const id = `${idPrefix}-folder-${folder.id}`;
              return (
                <div key={folder.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={chosen.has(folder.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(chosen);
                      if (c === true) next.add(folder.id);
                      else next.delete(folder.id);
                      onChange(true, [...next]);
                    }}
                  />
                  <Label htmlFor={id} className="truncate font-normal">
                    {folder.path}
                  </Label>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
