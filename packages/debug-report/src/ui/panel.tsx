/**
 * The preview panel: where a batch stops being a pile of sentences and becomes
 * something a person confirms.
 *
 * Three things happen here and nowhere else.
 *
 * **The reporter is the author.** The agent's issue text is editable, and the
 * sentence they typed is always shown next to it — a draft that quietly replaced
 * the observation would be the one failure this feature cannot survive.
 *
 * **This is the consent gate.** Every image that would leave is on screen before
 * anything is sent. That is stronger than a server-side redaction rule, because
 * a person looks at it (`docs/design/debug-report.md`, *Risks*).
 *
 * **PRs are shaped by three operations only** — detach an item, split a PR,
 * merge two. No file-shaped control, because the browser cannot know which files
 * an item touches; forced coupling happens on the repository side and comes back
 * as a reported delta. What is approved here is a SHAPE, not a promise about the
 * number of PRs, and the panel says so.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  detachItem,
  mergeGroups,
  splitGroup,
  type CaptureStore,
  type DebugItem,
  type DebugSession,
  type Disposition,
  type Draft,
  type HostAdapter,
  type ProposedGroup,
} from "../index";
import { ACCENT, describeTarget, PANEL_Z } from "./appearance";
import {
  handOver,
  handoverReport,
  handoverSummary,
  requestDrafts,
  type DraftState,
} from "./handover";

const DISPOSITIONS: Array<{ value: Disposition; label: string; hint: string }> = [
  { value: "verify", label: "Verify", hint: "Reproduce it, then open a PR if it holds" },
  { value: "publish", label: "File it", hint: "File as an issue without replaying it" },
  { value: "discard", label: "Drop", hint: "Do not send this one" },
];

export type DebugPanelProps = {
  session: DebugSession;
  store: CaptureStore;
  host: HostAdapter;
  sessionId: string;
  onClose: () => void;
};

export function DebugPanel({
  session,
  store,
  host,
  sessionId,
  onClose,
}: DebugPanelProps) {
  /**
   * SUBSCRIBED, not passed in.
   *
   * Taking the list as a prop made every control in here depend on the parent
   * re-rendering: an edit went to the session and came back only if something
   * else asked for it, so the field it was typed into showed a stale value.
   * Reading the session directly makes the panel correct on its own terms.
   */
  const items = useSyncExternalStore(
    useCallback((cb) => session.subscribe(cb), [session]),
    useCallback(() => session.items(), [session]),
  );
  const [draftState, setDraftState] = useState<DraftState>({ status: "idle" });
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const live = useMemo(
    () => items.filter((item) => item.disposition !== "discard"),
    [items],
  );

  const titleOf = useCallback(
    (itemId: string) =>
      drafts.get(itemId)?.title ??
      items.find((item) => item.id === itemId)?.note.slice(0, 70) ??
      "Report",
    [drafts, items],
  );

  // Ask for drafts as soon as the panel opens. What the reporter confirms IS the
  // issue text, so it has to exist before they are asked to confirm anything.
  useEffect(() => {
    let live = true;
    setDraftState({ status: "asking" });
    void requestDrafts(host, items).then((outcome) => {
      if (!live) return;
      setDraftState(outcome.state);
      setDrafts(outcome.drafts);
      setGroups(outcome.groups);
    });
    return () => {
      live = false;
    };
    // Deliberately keyed on the panel opening, not on `items`: re-drafting while
    // the reporter is editing would throw their edits away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const editDraft = (itemId: string, patch: Partial<Draft>) => {
    setDrafts((current) => {
      const next = new Map(current);
      const existing = next.get(itemId);
      if (!existing) return current;
      next.set(itemId, { ...existing, ...patch });
      return next;
    });
  };

  const onMergeClick = (groupId: string) => {
    if (!mergeFrom) return setMergeFrom(groupId);
    if (mergeFrom === groupId) return setMergeFrom(null);
    const merged = mergeGroups(groups, mergeFrom, groupId);
    setGroups(merged.groups);
    setWarning(merged.warning ?? null);
    setMergeFrom(null);
  };

  /**
   * What stops a blank field from becoming an unparseable bundle.
   *
   * `parseBundle` rejects an item with no note, and the write endpoint now runs
   * it — but without this the reporter's only signal would be a failed send.
   * The overlay refuses an empty note when the item is created; clearing the
   * field afterwards must not get around that.
   */
  const blank = useMemo(
    () =>
      live.filter(
        (item) =>
          item.note.trim().length === 0 ||
          (drafts.get(item.id) && drafts.get(item.id)!.title.trim().length === 0),
      ),
    [drafts, live],
  );

  const send = async () => {
    if (blank.length > 0) return;
    setSending(true);
    try {
      const result = await handOver({
        host,
        store,
        sessionId,
        items,
        groups,
        drafts,
      });
      setReport(handoverReport(result));
      if (result.sent.ok) {
        // Only what was SENT is forgotten. Clearing the whole session would
        // destroy the queued reports the reporter was just told were held back,
        // and would leave their images behind in the blob store to eat the
        // eviction budget of every session after this one.
        session.replaceAll(result.queuedItems);
        void store.sweep();
        setGroups(result.queued);
      }
    } catch (err) {
      // `handOver` reports a REFUSED send in `result.sent`, but it can still
      // throw: reading a capture out of IndexedDB, or the host adapter itself.
      // Without this the rejection was unhandled, the button re-enabled through
      // `finally`, and the reporter saw a click that did nothing — the one
      // outcome a consent gate may not produce. THE SESSION IS UNTOUCHED, so the
      // batch is still theirs to retry.
      setReport(
        `Nothing was sent — ${err instanceof Error ? err.message : String(err)}. Your reports are still here.`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-testid="debug-panel"
      data-wb-debug=""
      role="dialog"
      aria-label="Debug reports"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        bottom: 16,
        width: 520,
        zIndex: PANEL_Z,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 10,
        background: "#111",
        color: "#fff",
        font: "13px/1.5 system-ui, sans-serif",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Reports</strong>
        <span style={{ opacity: 0.6, fontSize: 11 }}>
          {handoverSummary(items, groups)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ marginLeft: "auto", ...ghostButton }}
        >
          Close (Esc)
        </button>
      </header>

      <DraftBanner state={draftState} />

      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {items.length === 0 && (
          <p style={{ opacity: 0.6 }}>
            Nothing collected yet. Aim at something and press <kbd>c</kbd>.
          </p>
        )}

        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            draft={drafts.get(item.id)}
            store={store}
            onNote={(note) => session.update(item.id, { note })}
            onDisposition={(disposition) => session.update(item.id, { disposition })}
            onAgentCandidate={(agentCandidate) =>
              session.update(item.id, { agentCandidate })
            }
            onDraft={(patch) => editDraft(item.id, patch)}
            onRemove={() => session.remove(item.id)}
          />
        ))}

        {groups.length > 0 && live.length > 0 && (
          <section aria-label="Proposed pull requests">
            <h3 style={{ fontSize: 12, opacity: 0.7, margin: "4px 0" }}>
              Proposed PRs
            </h3>
            <p style={{ fontSize: 11, opacity: 0.55, margin: "0 0 8px" }}>
              A shape, not a promise about the count: items that turn out to touch
              the same file are merged on the repository side, and every
              adjustment comes back with its reason.
            </p>
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                items={items}
                titleOf={titleOf}
                mergePending={mergeFrom === group.id}
                onDetach={(itemId) => setGroups((g) => detachItem(g, itemId, titleOf))}
                onSplit={() => setGroups((g) => splitGroup(g, group.id, titleOf))}
                onMerge={() => onMergeClick(group.id)}
              />
            ))}
          </section>
        )}
      </div>

      {warning && (
        <p data-testid="debug-panel-warning" style={{ ...noteText, color: "#ffd08a" }}>
          {warning}
        </p>
      )}
      {report && (
        <p data-testid="debug-panel-report" style={noteText}>
          {report}
        </p>
      )}

      <footer style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void send()}
          // NOT disabled while drafting: waiting on the model would make it a
          // dependency, which is the one thing this design says it is not. A
          // batch sent before the draft lands simply carries the reporter's own
          // sentences.
          disabled={sending || live.length === 0 || blank.length > 0}
          style={{
            ...primaryButton,
            background:
              sending || live.length === 0 || blank.length > 0 ? "#3a3a3a" : ACCENT,
          }}
        >
          {sending ? "Sending…" : `Hand over ${live.length} report(s)`}
        </button>
        {blank.length > 0 && (
          <span data-testid="debug-blank-note" style={{ fontSize: 11, color: "#ffd08a" }}>
            {blank.length} report(s) have an empty sentence or title — fill them in or
            drop them.
          </span>
        )}
        {blank.length === 0 && draftState.status === "asking" && (
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            waiting for the draft — you can send now, or edit first
          </span>
        )}
      </footer>
    </div>
  );
}

function DraftBanner({ state }: { state: DraftState }) {
  if (state.status === "ready") {
    if (state.dropped.length === 0) return null;
    return (
      <p data-testid="debug-draft-note" style={noteText}>
        {state.dropped.length} draft(s) were dropped: {state.dropped.join("; ")}.
      </p>
    );
  }
  if (state.status !== "unavailable") return null;
  return (
    <p data-testid="debug-draft-note" style={{ ...noteText, color: "#ffd08a" }}>
      {state.reason === "not-configured"
        ? "No model credential in the dev server, so there are no drafts — your own sentences are the issue text and each report becomes its own PR."
        : `Drafting did not answer (${state.reason}: ${state.detail}). Your sentences are the issue text and each report becomes its own PR.`}
    </p>
  );
}

function ItemCard({
  item,
  draft,
  store,
  onNote,
  onDisposition,
  onAgentCandidate,
  onDraft,
  onRemove,
}: {
  item: DebugItem;
  draft: Draft | undefined;
  store: Pick<CaptureStore, "getCapture">;
  onNote: (note: string) => void;
  onDisposition: (disposition: Disposition) => void;
  onAgentCandidate: (value: boolean) => void;
  onDraft: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const [thumb, setThumb] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!item.capture) return setThumb(undefined);
    let live = true;
    void store.getCapture(item.capture.id).then((dataUrl) => {
      if (live) setThumb(dataUrl);
    });
    return () => {
      live = false;
    };
  }, [item.capture, store]);

  const dimmed = item.disposition === "discard";

  return (
    <article
      data-testid="debug-item"
      data-item-id={item.id}
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: 10,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        {/* The consent gate: what would leave is on screen before it does. */}
        {thumb ? (
          <img
            src={thumb}
            alt={`capture for ${item.note}`}
            style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 4 }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 64,
              borderRadius: 4,
              background: "#1b1b1b",
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              opacity: 0.6,
            }}
          >
            {item.capture ? "image missing" : "no image"}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={srOnly} htmlFor={`note-${item.id}`}>
            What is wrong?
          </label>
          <input
            id={`note-${item.id}`}
            value={item.note}
            onChange={(e) => onNote(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
            {describeTarget(item.target)}
          </div>
        </div>
      </div>

      {draft && (
        <div style={{ marginTop: 8 }}>
          <label style={srOnly} htmlFor={`title-${item.id}`}>
            Issue title
          </label>
          <input
            id={`title-${item.id}`}
            value={draft.title}
            onChange={(e) => onDraft({ title: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ ...inputStyle, fontWeight: 600 }}
          />
          <label style={srOnly} htmlFor={`body-${item.id}`}>
            Issue body
          </label>
          <textarea
            id={`body-${item.id}`}
            value={draft.body}
            rows={3}
            onChange={(e) => onDraft({ body: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ ...inputStyle, marginTop: 4, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
            {draft.severity} · {draft.kind}
            {draft.labels.length > 0 ? ` · ${draft.labels.join(", ")}` : ""}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {DISPOSITIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            aria-pressed={item.disposition === option.value}
            onClick={() => onDisposition(option.value)}
            style={{
              ...ghostButton,
              borderColor: item.disposition === option.value ? ACCENT : "#444",
            }}
          >
            {option.label}
          </button>
        ))}
        <label style={{ fontSize: 11, opacity: 0.75, display: "flex", gap: 4 }}>
          <input
            type="checkbox"
            checked={item.agentCandidate}
            onChange={(e) => onAgentCandidate(e.target.checked)}
          />
          agent:candidate
        </label>
        <button
          type="button"
          onClick={onRemove}
          style={{ ...ghostButton, marginLeft: "auto" }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function GroupCard({
  group,
  items,
  titleOf,
  mergePending,
  onDetach,
  onSplit,
  onMerge,
}: {
  group: ProposedGroup;
  items: readonly DebugItem[];
  titleOf: (itemId: string) => string;
  mergePending: boolean;
  onDetach: (itemId: string) => void;
  onSplit: () => void;
  onMerge: () => void;
}) {
  const members = group.itemIds.filter((id) =>
    items.some((item) => item.id === id && item.disposition !== "discard"),
  );
  if (members.length === 0) return null;

  return (
    <div
      data-testid="debug-group"
      data-group-id={group.id}
      style={{
        border: `1px solid ${mergePending ? ACCENT : "#333"}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: 12 }}>{group.prTitle}</strong>
        <span style={{ fontSize: 11, opacity: 0.55 }}>
          {group.kind} · {members.length} item(s)
        </span>
      </div>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
        {members.map((itemId) => (
          <li
            key={itemId}
            style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {titleOf(itemId)}
            </span>
            {members.length > 1 && (
              <button type="button" onClick={() => onDetach(itemId)} style={ghostButton}>
                Detach
              </button>
            )}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
        {members.length > 1 && (
          <button type="button" onClick={onSplit} style={ghostButton}>
            Split
          </button>
        )}
        <button type="button" onClick={onMerge} style={ghostButton}>
          {mergePending ? "Pick the other PR…" : "Merge with…"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  borderRadius: 4,
  border: "1px solid #444",
  background: "#1b1b1b",
  color: "#fff",
  font: "inherit",
  outline: "none",
};

const ghostButton: React.CSSProperties = {
  padding: "3px 8px",
  borderRadius: 4,
  border: "1px solid #444",
  background: "transparent",
  color: "#fff",
  font: "11px/1.4 system-ui, sans-serif",
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 4,
  border: "none",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
};

const noteText: React.CSSProperties = { fontSize: 11, margin: 0, opacity: 0.85 };

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
