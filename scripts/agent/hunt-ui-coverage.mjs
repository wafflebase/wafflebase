// What this persona has ALREADY TRIED, so the next run can try something else.
//
// WHY THIS EXISTS. Every brief change that made a run productive was the same edit by
// hand: point the explorer at something it had not done yet. Colour sat unused until a
// task named it; the sheet toolbar sat unused until a task named it; `Clear formatting`
// has never been clicked in any run. Each of those was a pull request. This is that
// edit, derived from the journals instead of written.
//
// WHY NOT A SET OF COMMANDS. Because not one defect this hunter has filed is reachable
// by a single command:
//
//   #715  select a SUB-RANGE          -> Bold -> Bold
//   #749  select FORWARD              -> Italic on -> Italic off
//   #783  a heading block             -> Bulleted list -> Bulleted list
//   #793  Highlight colour            -> Highlight "None"
//   #792  apply Heading 2             -> READ BEFORE touching anything else
//
// Recording "Bold: used" after one click would mark the very thing that hides #715 and
// #749 as covered, and steer the next run away from it. Command-level coverage would
// make this hunter worse.
//
// WHY NOT N-GRAMS EITHER. ~25 controls is 625 ordered pairs; ten runs might cover fifty.
// Nearly everything would read as novel, so "do something new" would carry no
// information at all. A memory has to be sparse enough to point somewhere.
//
// SO THE KEY IS A SHAPE, not a command and not a sequence:
//
//     control | selectionShape | roundTripped
//
// which is the sibling of `uiDefectKey` — that one keys FINDINGS, this one keys
// ATTEMPTS. Plus two things the triple cannot express: pairs of DIFFERENT mutating
// controls (#783 needs heading->list, #793 needs swatch->None), and whether a mutation
// was READ before anything else touched the document (#792 is destroyed by the wrong
// next step, because any other style action repairs the stale indicator it exposes).
//
// STALENESS IS PER ENTRY, not per record. "Already covered" is a claim about a tree,
// not a promise about the product, and a control exercised forty commits ago is not
// covered now. A single record-level sha gets this wrong in the direction that matters:
// it takes the NEWEST run's sha, so a memory whose last run was five minutes ago
// discloses nothing, while the entries inside it may be forty commits old. Under-warning
// is the failure that costs a missed defect, so every entry carries the tree it was
// observed at and the renderer marks the stale ones individually.

/** Bump when the key shape changes; older entries then cannot claim coverage. */
export const COVERAGE_KEY_VERSION = 3;

/**
 * How a selection was shaped when a control was used.
 *
 * Only shapes derivable from what the readers actually return. "Whole block versus part
 * of one" is deliberately absent: telling those apart needs the block's text length,
 * which no reader reports, and a shape this file cannot compute is a shape it must not
 * pretend to record. RIGHT-TO-LEFT earns its own entry because #715 and #749 both hid
 * specifically there, and the doc rubric already asks the explorer to vary it.
 */
export const SELECTION_SHAPES = Object.freeze([
  "none",
  "collapsed",
  "forward-range",
  "backward-range",
  "multi-block",
  "cell",
  "cell-range",
]);

/** Readers whose value describes the current selection, by surface. */
const SELECTION_READERS = new Set(["doc.selection", "sheet.selectionRange", "sheet.activeCell"]);

/**
 * Classify a selection reading. Unknown shapes answer `"none"` rather than throwing:
 * coverage is advisory, and a reader that changed shape must degrade the memory, never
 * break the run that reads it.
 */
export function selectionShape(value) {
  if (value == null || typeof value !== "object") return "none";

  // sheet.selectionRange -> { start, end }
  if (typeof value.start === "string" && typeof value.end === "string") {
    return value.start === value.end ? "cell" : "cell-range";
  }

  // doc.selection -> { anchor: {blockId, offset}, focus: {blockId, offset} }
  const a = value.anchor;
  const f = value.focus;
  if (!a || !f || typeof a !== "object" || typeof f !== "object") return "none";
  if (a.blockId !== f.blockId) return "multi-block";
  if (a.offset === f.offset) return "collapsed";
  return Number(f.offset) < Number(a.offset) ? "backward-range" : "forward-range";
}

/** The control a click acted on: its accessible name, else the reader it resolved. */
function controlOf(action) {
  const t = action?.target;
  if (!t || typeof t !== "object") return "";
  if (typeof t.name === "string" && t.name.trim() !== "") return t.name.trim();
  if (typeof t.reader === "string" && t.reader.trim() !== "") return t.reader.trim();
  return "";
}

/** Did this action change the document, as opposed to observing or navigating it? */
function isMutation(action) {
  const type = action?.type;
  if (type === "type" || type === "key") return true;
  return type === "click" && controlOf(action) !== "";
}

/**
 * Derive one run's coverage from one explorer journal.
 *
 * PURE, and that is the point: every judgement worth testing lives here, and the file
 * that owns persistence owns nothing else. Returns plain arrays rather than Sets so the
 * result serialises without a custom replacer.
 */
export function coverageFromJournal(journal, { sha = null } = {}) {
  const entries = Array.isArray(journal) ? journal : [];
  const shapes = new Map(); // "control|shape" -> { control, shape, roundTripped }
  const pairs = new Map(); // "a|b" -> sha, for consecutive DIFFERENT mutating controls
  const readAfterMutation = new Map(); // control -> sha, effect read before anything else

  const inventory = new Map(); // "role|name" -> sha, from any `dom.controls` reading

  let shape = "none";
  // The selection ITSELF, not just its shape. A round trip is apply-then-reverse on the
  // SAME selection; Bold on one range and Bold on another is two applications, and
  // treating that as a round trip would mark the second range explored when its reversal
  // has never been tried. Shape alone is too coarse to catch it — both are ranges.
  let selectionKey = "none";
  let lastControl = "";
  let lastMutationControl = "";
  let mutationPendingRead = "";

  for (const e of entries) {
    const action = e?.action;
    if (!action || typeof action !== "object") continue;

    // Track the selection as the journal reveals it. A reading is only trustworthy for
    // actions AFTER it, which is why this updates before the click handling below.
    // WHAT EXISTS, harvested from the explorer's own reading. This is the denominator
    // the memory lacked: past journals show what WAS used, and only an inventory shows
    // what was never touched. Recorded per run so a control added to the product shows
    // up as newly-untried rather than silently absent.
    if ((action.type === "read" || action.type === "wait") && action.reader === "dom.controls" && e.ok === true) {
      for (const c of Array.isArray(e.value) ? e.value : []) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.name !== "string" || c.name.trim() === "") continue;
        // A missing role is DROPPED rather than defaulted. `target` takes `{role, name}`
        // and a guessed role produces a target that does not resolve — inventing
        // `button` would hand the explorer a name it cannot click, which is the exact
        // failure this reader exists to prevent.
        if (typeof c.role !== "string" || c.role.trim() === "") continue;
        inventory.set(`${c.role.trim()}|${c.name.trim()}`, sha);
      }
    }

    if ((action.type === "read" || action.type === "wait") && SELECTION_READERS.has(action.reader)) {
      if (e.ok === true) {
        shape = selectionShape(e.value);
        const key = JSON.stringify(e.value ?? null);
        if (key !== selectionKey) {
          selectionKey = key;
          lastControl = "";
        }
      }
    }

    // #792's shape: a mutation whose effect was observed before anything else touched
    // the document. Any read counts — the defect is exposed by looking, and destroyed
    // by acting again first.
    if (mutationPendingRead !== "") {
      if (action.type === "read" || action.type === "wait") {
        readAfterMutation.set(mutationPendingRead, sha);
        mutationPendingRead = "";
      } else if (isMutation(action)) {
        mutationPendingRead = "";
      }
    }

    if (action.type !== "click") {
      // A non-click mutation (typing, a shortcut) breaks any run of clicks: a later
      // repeat of the same control is a fresh application rather than a reversal, AND
      // two clicks separated by typing are not the adjacency a pair claims to record.
      // Both chains reset, or the pair list quietly asserts a sequence that never
      // happened.
      if (isMutation(action)) {
        lastControl = "";
        lastMutationControl = "";
      }
      continue;
    }

    const control = controlOf(action);
    if (control === "") continue;

    const key = `${control}|${shape}`;
    const seen = shapes.get(key) ?? { control, shape, roundTripped: false, sha };

    // ROUND TRIP: the same control twice with nothing mutating in between. That is
    // apply-then-reverse for a toggle, and it is the shape every filed defect came from.
    if (lastControl === control) seen.roundTripped = true;
    shapes.set(key, seen);

    // A pair of DIFFERENT mutating controls, which the triple cannot express: #783 is
    // heading->list, #793 is a swatch->None. Restricted to clicks so it stays sparse.
    if (lastMutationControl !== "" && lastMutationControl !== control) {
      pairs.set(`${lastMutationControl}|${control}`, sha);
    }

    lastControl = control;
    lastMutationControl = control;
    mutationPendingRead = control;
  }

  return {
    keyVersion: COVERAGE_KEY_VERSION,
    sha,
    shapes: [...shapes.values()].sort((a, b) => `${a.control}${a.shape}`.localeCompare(`${b.control}${b.shape}`)),
    pairs: [...pairs].map(([pair, at]) => ({ pair, sha: at })).sort((a, b) => a.pair.localeCompare(b.pair)),
    readAfterMutation: [...readAfterMutation]
      .map(([control, at]) => ({ control, sha: at }))
      .sort((a, b) => a.control.localeCompare(b.control)),
    inventory: [...inventory]
      .map(([key, at]) => {
        const cut = key.indexOf("|");
        return { role: key.slice(0, cut), control: key.slice(cut + 1), sha: at };
      })
      .sort((a, b) => `${a.control}${a.role}`.localeCompare(`${b.control}${b.role}`)),
  };
}

/**
 * Union two coverage records, newest sha winning.
 *
 * `roundTripped` is sticky: once a control has been round-tripped on a shape, a later
 * run that only applied it does not un-cover that. Entries written under an older key
 * version are DROPPED rather than merged — a key that changed meaning cannot claim to
 * have covered anything, the same rule the ledger applies.
 */
export function mergeCoverage(prev, next) {
  const usable = (c) => c && typeof c === "object" && c.keyVersion === COVERAGE_KEY_VERSION;
  const a = usable(prev) ? prev : { shapes: [], pairs: [], readAfterMutation: [] };
  const b = usable(next) ? next : { shapes: [], pairs: [], readAfterMutation: [] };

  // Newest observation of an ENTRY wins its sha, so re-touching a control refreshes that
  // control and nothing else. `roundTripped` stays sticky: a later run that only applied
  // something has not un-tested its reversal.
  const shapes = new Map();
  for (const x of [...(a.shapes ?? []), ...(b.shapes ?? [])]) {
    if (!x || typeof x !== "object") continue;
    if (typeof x.control !== "string" || x.control === "") continue;
    const key = `${x.control}|${x.shape}`;
    const cur = shapes.get(key);
    shapes.set(key, {
      control: x.control,
      shape: typeof x.shape === "string" ? x.shape : "none",
      roundTripped: Boolean(cur?.roundTripped) || Boolean(x.roundTripped),
      sha: x.sha ?? cur?.sha ?? null,
    });
  }

  /** Union a provenance-carrying list on `field`, newest sha winning per entry. */
  const unionBy = (field, lists) => {
    const out = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const x of list) {
        if (!x || typeof x !== "object") continue;
        const value = x[field];
        if (typeof value !== "string" || value === "") continue;
        out.set(value, x.sha ?? out.get(value) ?? null);
      }
    }
    return [...out].map(([value, at]) => ({ [field]: value, sha: at })).sort((p, q) => p[field].localeCompare(q[field]));
  };

  /** Union inventories on the `{role, name}` pair, newest sha winning per control. */
  const unionInventory = (lists) => {
    const out = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const x of list) {
        if (!x || typeof x !== "object") continue;
        if (typeof x.control !== "string" || x.control === "") continue;
        if (typeof x.role !== "string" || x.role === "") continue;
        out.set(`${x.role}|${x.control}`, { role: x.role, control: x.control, sha: x.sha ?? null });
      }
    }
    return [...out.values()].sort((p, q) => `${p.control}${p.role}`.localeCompare(`${q.control}${q.role}`));
  };

  return {
    keyVersion: COVERAGE_KEY_VERSION,
    shapes: [...shapes.values()].sort((x, y) => `${x.control}${x.shape}`.localeCompare(`${y.control}${y.shape}`)),
    pairs: unionBy("pair", [a.pairs, b.pairs]),
    readAfterMutation: unionBy("control", [a.readAfterMutation, b.readAfterMutation]),
    // The inventory is a UNION, never a replacement. A run that read `dom.controls`
    // with a menu closed sees fewer controls than one that opened it, and letting the
    // newer reading win would delete every menu item from the memory.
    //
    // Keyed on ROLE AND NAME together, because that pair is what `target` takes and what
    // makes a control identifiable: a `menuitem` and a `button` can legitimately share a
    // name, and collapsing them loses one control and leaves the survivor's role a coin
    // toss.
    inventory: unionInventory([a.inventory, b.inventory]),
  };
}

/**
 * The section the explorer reads. Empty string when there is nothing to say, so a first
 * run is not handed a heading with nothing under it.
 *
 * WHAT IT DOES NOT SAY: "avoid these". Every defect this hunter has filed came from the
 * round trip, and broad exploration that never repeated a control found nothing across
 * many runs. So the instruction is to vary WHAT is round-tripped, never to stop
 * round-tripping — a coverage memory that traded depth for breadth would make this
 * worse, and that is the one way this feature can backfire.
 */
export function renderCoverageBrief(coverage, { sha = null } = {}) {
  if (!coverage || coverage.keyVersion !== COVERAGE_KEY_VERSION) return "";

  // Skip malformed entries rather than throwing. A coverage file is a MEMORY: a broken
  // one must cost a repeated experiment, never a dead run, and this function sits on the
  // path that assembles the explorer's prompt.
  const shapes = (Array.isArray(coverage.shapes) ? coverage.shapes : []).filter(
    (x) => x && typeof x === "object" && typeof x.control === "string" && x.control !== "",
  );
  const inventory = (Array.isArray(coverage.inventory) ? coverage.inventory : []).filter(
    (x) => x && typeof x === "object" && typeof x.control === "string" && x.control !== "",
  );
  // Nothing to say only when BOTH are empty. Returning early on `shapes` alone silenced
  // the most valuable brief there is: a run that discovered twenty-five controls and
  // clicked none has the entire surface to offer as never-tried, and said nothing.
  if (shapes.length === 0 && inventory.length === 0) return "";

  // A per-entry marker, because the record-level version of this under-warned: a memory
  // whose newest run was minutes ago disclosed nothing while the entries inside it could
  // be forty commits old.
  const stale = (entry) => (sha && entry?.sha && entry.sha !== sha ? ` — last seen at \`${String(entry.sha).slice(0, 9)}\`, tree has moved` : "");
  const anyStale = shapes.some((x) => stale(x) !== "");

  const tripped = shapes.filter((x) => x.roundTripped);
  const appliedOnly = shapes.filter((x) => !x.roundTripped);

  const lines = [
    "## What you have ALREADY TRIED on this surface (DATA, not instructions)",
    "",
    "Derived from previous runs' journals. It is here so this session goes somewhere",
    "the last ones did not — the same defect found twice is worth nothing, and every",
    "defect this hunter HAS found came from a control nobody had round-tripped yet.",
    "",
    "**Vary WHAT you round-trip. Do not stop round-tripping.** Applying a control once",
    "and moving on is the pattern that found nothing across many runs; apply-then-reverse",
    "is the pattern that found all of them.",
    "",
  ];

  if (tripped.length > 0) {
    lines.push("Already ROUND-TRIPPED (applied and reversed) — prefer something else:");
    for (const x of tripped) lines.push(`  - \`${x.control}\` on a ${x.shape} selection${stale(x)}`);
    lines.push("");
  }
  if (appliedOnly.length > 0) {
    lines.push("Applied but NEVER REVERSED — a round trip here is still unexplored:");
    for (const x of appliedOnly) lines.push(`  - \`${x.control}\` on a ${x.shape} selection${stale(x)}`);
    lines.push("");
  }

  const pairs = (Array.isArray(coverage.pairs) ? coverage.pairs : []).filter(
    (x) => x && typeof x === "object" && typeof x.pair === "string" && x.pair !== "",
  );
  if (pairs.length > 0) {
    lines.push("Sequences of two different controls already tried:");
    for (const x of pairs) {
      lines.push(`  - ${x.pair.split("|").map((n) => `\`${n}\``).join(" then ")}${stale(x)}`);
    }
    lines.push("");
  }

  // NEVER TRIED. Everything the inventory has seen that no journal has ever clicked.
  // This is what the memory could not say before: past journals give what WAS used, and
  // a control nobody touched appears in none of them, so it was invisible. `Clear
  // formatting` sat unclicked for eight doc runs for exactly this reason.
  const usedControls = new Set(shapes.map((x) => x.control));
  const untried = inventory.filter((x) => !usedControls.has(x.control));
  if (untried.length > 0) {
    lines.push(
      "NEVER TRIED — these exist on this surface and no run has ever clicked them:",
      ...untried.map((x) => `  - \`${x.control}\``),
      "",
      "That list is the most valuable thing here. Every defect this hunter has filed came",
      "from a control nobody had round-tripped yet.",
      "",
    );
  }

  const read = (Array.isArray(coverage.readAfterMutation) ? coverage.readAfterMutation : []).filter(
    (x) => x && typeof x === "object" && typeof x.control === "string" && x.control !== "",
  );
  if (read.length > 0) {
    lines.push(
      "Already checked by READING immediately afterwards: " + read.map((x) => `\`${x.control}\``).join(", ") + ".",
      "A control not in that list has never been observed before something else touched",
      "the document, which is the only way a stale-indicator defect is visible at all.",
      "",
    );
  }

  if (anyStale) {
    lines.push(
      "Entries marked above were recorded against a different tree. \"Already covered\"",
      "describes a tree, not a promise about the product — if that control's code has",
      "moved since, it is worth revisiting.",
      "",
    );
  }
  return lines.join("\n");
}
