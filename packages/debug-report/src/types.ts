/**
 * The item / bundle model, and the fail-closed parser for it.
 *
 * A bundle is what crosses a trust boundary: out of the browser into
 * `.wb-reports/` (dev) or the mailbox (SP2), and from there into a pipeline
 * that can create commits. So `parseBundle` REJECTS rather than repairs. A
 * bundle that is only partly understood is one the pipeline must not act on —
 * a dropped field there is not a cosmetic loss, it is a PR opened for a reason
 * nobody stated.
 *
 * Design: `docs/design/debug-report.md`.
 */

/** Bundle schema version. Bump when a field changes meaning, not when one is added. */
export const BUNDLE_SCHEMA = 1;

// Geometry comes from `@wafflebase/core/geometry`, which is where the repository
// keeps `Point`/`Rect` and the predicates over them (`rectsIntersect`,
// `normalizeRect`). Re-exported rather than imported-and-forgotten so a consumer
// of this package needs one import, and defined nowhere here so there is no
// second definition to drift — that subpath exists because five copies of these
// aliases had already accumulated inside `slides` alone.
export type { Point, Rect } from '@wafflebase/core/geometry';
import type { Rect } from '@wafflebase/core/geometry';

/**
 * What the reporter pointed at.
 *
 * `dom` carries no image on purpose: a selector, a box and a text excerpt
 * describe a DOM node better than pixels do, and the text on screen is the
 * agent's only grep key into the source. `canvas` is the opposite case — there
 * is no DOM description to be had, so pixels are the description.
 */
export type Target =
  | {
      kind: 'dom';
      /** Short, human-readable path. Not claimed to be stable across builds. */
      selector: string;
      tag: string;
      /** Nearest `data-testid` / `data-*` hook, when the node or an ancestor has one. */
      testId?: string;
      /** Visible text, truncated. The grep key. */
      text?: string;
      rect: Rect;
    }
  | {
      kind: 'canvas';
      /** Which engine surface — `sheet`, `doc`, `slides`, `board`. */
      surface: string;
      rect: Rect;
      /**
       * Semantic address from the engine locator (`Sheet1!C7`, a docs offset).
       * Absent means the locator could not answer; the pixels stand alone, and
       * per SP0 finding 4 the region is a small one around the cursor rather
       * than a photograph of the whole surface.
       */
      address?: string;
    }
  | {
      /**
       * A region rather than a single node.
       *
       * Where a canvas backs it the pixels are the description; where the DOM
       * does, `elements` is — and it must be filled in. Measured on `/login`
       * and `/harness/visual` (zero canvases), a region produced an item with
       * no capture, no selector and no text: coordinates and nothing else,
       * which no agent can act on (`docs/design/debug-report.md`, finding 7).
       */
      kind: 'viewport';
      rect: Rect;
      elements?: DomElementRef[];
    };

/**
 * One DOM element, as a report can name it.
 *
 * The text excerpt is the load-bearing field: it is the agent's only grep key
 * into the source, because a selector built from utility classes is a hint and
 * not an identity.
 */
export type DomElementRef = {
  selector: string;
  tag: string;
  text?: string;
  rect: Rect;
};

/**
 * Capture METADATA. The bytes live in the store under `id` — a bundle carries
 * image data separately so metadata stays small enough for `localStorage` and
 * cheap enough to list without decoding megabytes.
 */
export type Capture = {
  id: string;
  w: number;
  h: number;
  bytes: number;
  /** How many stacked canvases were composited (SP0 finding 2). */
  layers: number;
  mime: string;
};

/** Where the reporter wants this item to go. */
export const DISPOSITIONS = ['verify', 'publish', 'discard'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * The kind of change the item asks for. Drives grouping: same kind groups,
 * `layout` groups only within one file, `logic` never groups.
 */
export const CHANGE_KINDS = [
  'spacing',
  'color',
  'token',
  'copy',
  'a11y',
  'affordance',
  'layout',
  'logic',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** `scripts/agent/severity.mjs` scale, so a draft's estimate speaks the panel's language. */
export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Agent-written issue text, produced at preview time and edited by the reporter. */
export type Draft = {
  title: string;
  body: string;
  severity: Severity;
  kind: ChangeKind;
  labels: string[];
};

/** A proposed PR: elective coupling only — no file information exists yet. */
export type ProposedGroup = {
  id: string;
  kind: ChangeKind;
  itemIds: string[];
  prTitle: string;
};

/** One observation. */
export type DebugItem = {
  id: string;
  createdAt: number;
  /** The reporter's sentence. For an appearance report this is the ground truth. */
  note: string;
  target: Target;
  capture?: Capture;
  disposition: Disposition;
  /**
   * Records the reporter's INTENT to hand this to the autonomous loop. It does
   * not grant it: that gate needs a non-Bot author too, so a local run applies
   * the label and Actions mode renders a checklist instead.
   */
  agentCandidate: boolean;
  draft?: Draft;
};

/**
 * Where the observation happened.
 *
 * `buildSha` is not decoration: without it the agent does not know which code
 * it is reading, and a report against yesterday's bundle is worse than no
 * report. `route` arrives with document ids already anonymised by the caller.
 */
export type Environment = {
  buildSha?: string;
  route: string;
  viewport: { w: number; h: number };
  dpr: number;
  theme: string;
  userAgent: string;
  documentType?: string;
  role?: string;
};

export type Bundle = {
  schema: number;
  sessionId: string;
  createdAt: number;
  env: Environment;
  items: DebugItem[];
  /** Present once the reporter has confirmed a grouping. */
  groups?: ProposedGroup[];
};

export type ParseResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; errors: string[] };

/**
 * What the drafting endpoint is asked to draft.
 *
 * NOT a `Bundle`, and the difference is the point: drafting happens BEFORE the
 * reporter confirms, so there is no `sessionId`, no `createdAt` and no
 * confirmed grouping yet. `parseBundle` would reject every legitimate draft
 * request, which is why this has its own parser rather than reusing that one.
 */
export type DraftRequest = {
  items: DebugItem[];
  env: Environment;
};

export type DraftRequestParse =
  | { ok: true; request: DraftRequest }
  | { ok: false; errors: string[] };

/**
 * The most items one drafting call may carry.
 *
 * `MAX_SESSION_PRS × MAX_GROUP_ITEMS` from `draft.ts` — the most a single batch
 * could ever send. The number is written out rather than imported because
 * `draft.ts` imports THIS module, and a cycle between the two would be a worse
 * problem than a duplicated constant.
 *
 * REFUSED, not truncated. Drafting 40 of 60 items and grouping only those would
 * hand the reporter a preview that silently omits a third of what they
 * collected, which is the exact failure `normaliseGroups`' coverage rule exists
 * to prevent.
 */
export const MAX_DRAFT_ITEMS = 5 * 8;

/**
 * Validate a drafting request before a model credential is spent on it.
 *
 * The endpoint that calls this listens on a port every page the developer
 * visits can reach, and answering it costs tokens. An unvalidated body is
 * therefore not merely untidy: it is an unbounded bill payable by anything that
 * can issue a same-origin POST.
 */
export function parseDraftRequest(input: unknown): DraftRequestParse {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`draftRequest: not valid JSON (${String(err)})`] };
    }
  }
  if (!isRecord(value)) {
    return { ok: false, errors: ['draftRequest: expected an object'] };
  }
  if (!Array.isArray(value.items)) {
    return { ok: false, errors: ['draftRequest.items: expected an array'] };
  }
  if (value.items.length === 0) {
    return { ok: false, errors: ['draftRequest.items: expected at least one item'] };
  }
  if (value.items.length > MAX_DRAFT_ITEMS) {
    return {
      ok: false,
      errors: [
        `draftRequest.items: ${value.items.length} items exceeds the ${MAX_DRAFT_ITEMS} one batch can send`,
      ],
    };
  }

  const e = new Errors();
  const env = parseEnv(value.env, 'draftRequest.env', e);
  const items: DebugItem[] = [];
  const ids = new Set<string>();
  value.items.forEach((raw, i) => {
    const item = parseItem(raw, `draftRequest.items[${i}]`, e);
    if (!item) return;
    if (ids.has(item.id)) {
      e.bad(`draftRequest.items[${i}].id`, `duplicate item id ${item.id}`);
      return;
    }
    ids.add(item.id);
    items.push(item);
  });

  if (e.list.length > 0 || !env) return { ok: false, errors: e.list };
  return { ok: true, request: { items, env } };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * An OPTIONAL non-empty string: absent is fine, malformed is not.
 *
 * `isNonEmptyString(v) ? { k: v } : {}` failed OPEN — a bundle carrying
 * `text: 42` or `testId: ''` parsed as `ok: true` with the field silently
 * removed. That contradicts the fail-closed contract, and for `text` it drops
 * the agent's only grep key into the source without telling anyone. Absent
 * (`undefined`) is accepted; anything present that is not a non-empty string is
 * a rejection.
 */
function optionalString(
  v: unknown,
  path: string,
  e: { bad: (at: string, why: string) => void },
): { ok: true; value?: string } | { ok: false } {
  if (v === undefined) return { ok: true };
  if (isNonEmptyString(v)) return { ok: true, value: v };
  e.bad(path, 'expected a non-empty string when present');
  return { ok: false };
}

/**
 * Accumulates paths of everything wrong, rather than throwing on the first.
 *
 * One rejection listing every problem is what makes a schema change debuggable;
 * a parser that stops at the first field turns a version skew into a sequence
 * of single-field mysteries.
 */
class Errors {
  readonly list: string[] = [];
  bad(path: string, why: string): false {
    this.list.push(`${path}: ${why}`);
    return false;
  }
}

function parseRect(v: unknown, path: string, e: Errors): Rect | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (!isFiniteNumber(v[k])) {
      e.bad(`${path}.${k}`, 'expected a finite number');
      return undefined;
    }
  }
  const w = v.w as number;
  const h = v.h as number;
  if (w < 0 || h < 0) {
    e.bad(path, 'expected non-negative width and height');
    return undefined;
  }
  return { x: v.x as number, y: v.y as number, w, h };
}

function parseTarget(v: unknown, path: string, e: Errors): Target | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  const rect = parseRect(v.rect, `${path}.rect`, e);
  if (!rect) return undefined;

  switch (v.kind) {
    case 'dom': {
      if (!isNonEmptyString(v.selector)) {
        e.bad(`${path}.selector`, 'expected a non-empty string');
        return undefined;
      }
      if (!isNonEmptyString(v.tag)) {
        e.bad(`${path}.tag`, 'expected a non-empty string');
        return undefined;
      }
      const testId = optionalString(v.testId, `${path}.testId`, e);
      const text = optionalString(v.text, `${path}.text`, e);
      if (!testId.ok || !text.ok) return undefined;
      return {
        kind: 'dom',
        selector: v.selector,
        tag: v.tag,
        ...(testId.value === undefined ? {} : { testId: testId.value }),
        ...(text.value === undefined ? {} : { text: text.value }),
        rect,
      };
    }
    case 'canvas': {
      if (!isNonEmptyString(v.surface)) {
        e.bad(`${path}.surface`, 'expected a non-empty string');
        return undefined;
      }
      const address = optionalString(v.address, `${path}.address`, e);
      if (!address.ok) return undefined;
      return {
        kind: 'canvas',
        surface: v.surface,
        rect,
        ...(address.value === undefined ? {} : { address: address.value }),
      };
    }
    case 'viewport': {
      if (v.elements === undefined) return { kind: 'viewport', rect };
      if (!Array.isArray(v.elements)) {
        e.bad(`${path}.elements`, 'expected an array');
        return undefined;
      }
      const elements: DomElementRef[] = [];
      for (const [i, raw] of v.elements.entries()) {
        const at = `${path}.elements[${i}]`;
        if (!isRecord(raw)) {
          e.bad(at, 'expected an object');
          return undefined;
        }
        const elementRect = parseRect(raw.rect, `${at}.rect`, e);
        if (!elementRect) return undefined;
        if (!isNonEmptyString(raw.selector)) {
          e.bad(`${at}.selector`, 'expected a non-empty string');
          return undefined;
        }
        if (!isNonEmptyString(raw.tag)) {
          e.bad(`${at}.tag`, 'expected a non-empty string');
          return undefined;
        }
        elements.push({
          selector: raw.selector,
          tag: raw.tag,
          ...(isNonEmptyString(raw.text) ? { text: raw.text } : {}),
          rect: elementRect,
        });
      }
      return { kind: 'viewport', rect, elements };
    }
    default:
      e.bad(`${path}.kind`, `unknown target kind ${JSON.stringify(v.kind)}`);
      return undefined;
  }
}

function parseCapture(
  v: unknown,
  path: string,
  e: Errors,
): Capture | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  if (!isNonEmptyString(v.id)) {
    e.bad(`${path}.id`, 'expected a non-empty string');
    return undefined;
  }
  for (const k of ['w', 'h', 'bytes', 'layers'] as const) {
    if (!isFiniteNumber(v[k]) || (v[k] as number) < 0) {
      e.bad(`${path}.${k}`, 'expected a non-negative finite number');
      return undefined;
    }
  }
  if (!isNonEmptyString(v.mime)) {
    e.bad(`${path}.mime`, 'expected a non-empty string');
    return undefined;
  }
  return {
    id: v.id,
    w: v.w as number,
    h: v.h as number,
    bytes: v.bytes as number,
    layers: v.layers as number,
    mime: v.mime,
  };
}

function parseDraft(v: unknown, path: string, e: Errors): Draft | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  if (!isNonEmptyString(v.title)) {
    e.bad(`${path}.title`, 'expected a non-empty string');
    return undefined;
  }
  if (typeof v.body !== 'string') {
    e.bad(`${path}.body`, 'expected a string');
    return undefined;
  }
  if (!SEVERITIES.includes(v.severity as Severity)) {
    e.bad(`${path}.severity`, `expected one of ${SEVERITIES.join(' | ')}`);
    return undefined;
  }
  if (!CHANGE_KINDS.includes(v.kind as ChangeKind)) {
    e.bad(`${path}.kind`, `expected one of ${CHANGE_KINDS.join(' | ')}`);
    return undefined;
  }
  if (!Array.isArray(v.labels) || !v.labels.every(isNonEmptyString)) {
    e.bad(`${path}.labels`, 'expected an array of non-empty strings');
    return undefined;
  }
  return {
    title: v.title,
    body: v.body,
    severity: v.severity as Severity,
    kind: v.kind as ChangeKind,
    labels: v.labels as string[],
  };
}

function parseItem(v: unknown, path: string, e: Errors): DebugItem | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  if (!isNonEmptyString(v.id)) {
    e.bad(`${path}.id`, 'expected a non-empty string');
    return undefined;
  }
  if (!isFiniteNumber(v.createdAt)) {
    e.bad(`${path}.createdAt`, 'expected a finite number');
    return undefined;
  }
  // A note is the one thing an item cannot be missing: it is what the reporter
  // said, and for an appearance report it is the ground truth the review lens
  // judges against. An item without it has nothing to verify.
  if (!isNonEmptyString(v.note)) {
    e.bad(`${path}.note`, 'expected a non-empty string');
    return undefined;
  }
  if (!DISPOSITIONS.includes(v.disposition as Disposition)) {
    e.bad(
      `${path}.disposition`,
      `expected one of ${DISPOSITIONS.join(' | ')}`,
    );
    return undefined;
  }
  if (typeof v.agentCandidate !== 'boolean') {
    e.bad(`${path}.agentCandidate`, 'expected a boolean');
    return undefined;
  }
  const target = parseTarget(v.target, `${path}.target`, e);
  if (!target) return undefined;

  let capture: Capture | undefined;
  if (v.capture !== undefined) {
    capture = parseCapture(v.capture, `${path}.capture`, e);
    if (!capture) return undefined;
  }

  let draft: Draft | undefined;
  if (v.draft !== undefined) {
    draft = parseDraft(v.draft, `${path}.draft`, e);
    if (!draft) return undefined;
  }

  return {
    id: v.id,
    createdAt: v.createdAt as number,
    note: v.note,
    target,
    ...(capture ? { capture } : {}),
    disposition: v.disposition as Disposition,
    agentCandidate: v.agentCandidate,
    ...(draft ? { draft } : {}),
  };
}

function parseEnv(v: unknown, path: string, e: Errors): Environment | undefined {
  if (!isRecord(v)) {
    e.bad(path, 'expected an object');
    return undefined;
  }
  if (typeof v.route !== 'string') {
    e.bad(`${path}.route`, 'expected a string');
    return undefined;
  }
  const viewport = isRecord(v.viewport) ? v.viewport : undefined;
  if (
    !viewport ||
    !isFiniteNumber(viewport.w) ||
    !isFiniteNumber(viewport.h)
  ) {
    e.bad(`${path}.viewport`, 'expected { w, h } finite numbers');
    return undefined;
  }
  if (!isFiniteNumber(v.dpr) || (v.dpr as number) <= 0) {
    e.bad(`${path}.dpr`, 'expected a positive finite number');
    return undefined;
  }
  if (typeof v.theme !== 'string') {
    e.bad(`${path}.theme`, 'expected a string');
    return undefined;
  }
  if (typeof v.userAgent !== 'string') {
    e.bad(`${path}.userAgent`, 'expected a string');
    return undefined;
  }
  const buildSha = optionalString(v.buildSha, `${path}.buildSha`, e);
  const documentType = optionalString(v.documentType, `${path}.documentType`, e);
  const role = optionalString(v.role, `${path}.role`, e);
  if (!buildSha.ok || !documentType.ok || !role.ok) return undefined;
  return {
    ...(buildSha.value === undefined ? {} : { buildSha: buildSha.value }),
    route: v.route,
    viewport: { w: viewport.w as number, h: viewport.h as number },
    dpr: v.dpr as number,
    theme: v.theme,
    userAgent: v.userAgent,
    ...(documentType.value === undefined ? {} : { documentType: documentType.value }),
    ...(role.value === undefined ? {} : { role: role.value }),
  };
}

function parseGroups(
  v: unknown,
  path: string,
  itemIds: Set<string>,
  e: Errors,
): ProposedGroup[] | undefined {
  if (!Array.isArray(v)) {
    e.bad(path, 'expected an array');
    return undefined;
  }
  const groups: ProposedGroup[] = [];
  const seenGroupIds = new Set<string>();
  const claimed = new Set<string>();
  v.forEach((raw, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(raw)) return void e.bad(at, 'expected an object');
    if (!isNonEmptyString(raw.id)) {
      return void e.bad(`${at}.id`, 'expected a non-empty string');
    }
    if (seenGroupIds.has(raw.id)) {
      return void e.bad(`${at}.id`, `duplicate group id ${raw.id}`);
    }
    if (!CHANGE_KINDS.includes(raw.kind as ChangeKind)) {
      return void e.bad(`${at}.kind`, `expected one of ${CHANGE_KINDS.join(' | ')}`);
    }
    if (!isNonEmptyString(raw.prTitle)) {
      return void e.bad(`${at}.prTitle`, 'expected a non-empty string');
    }
    if (
      !Array.isArray(raw.itemIds) ||
      raw.itemIds.length === 0 ||
      !raw.itemIds.every(isNonEmptyString)
    ) {
      return void e.bad(
        `${at}.itemIds`,
        'expected a non-empty array of non-empty strings',
      );
    }
    // A group naming an item that is not in the bundle, or naming one another
    // group already claimed, describes a PR shape the pipeline cannot build.
    // Both are rejections: silently dropping the reference would open a PR
    // that differs from the one the reporter approved, which is the exact
    // failure the delta reporting exists to prevent.
    for (const id of raw.itemIds as string[]) {
      if (!itemIds.has(id)) {
        e.bad(`${at}.itemIds`, `no such item ${id}`);
        return;
      }
      if (claimed.has(id)) {
        e.bad(`${at}.itemIds`, `item ${id} is already in another group`);
        return;
      }
    }
    for (const id of raw.itemIds as string[]) claimed.add(id);
    seenGroupIds.add(raw.id);
    groups.push({
      id: raw.id,
      kind: raw.kind as ChangeKind,
      itemIds: raw.itemIds as string[],
      prTitle: raw.prTitle,
    });
  });
  return e.list.length > 0 ? undefined : groups;
}

/**
 * Parse an untrusted bundle. Fail-closed: any unrecognised or malformed field
 * rejects the whole bundle.
 *
 * Accepts a JSON string or an already-parsed value, because the two call sites
 * differ — a file read hands over text, a fetch body hands over an object —
 * and forcing one to re-serialise for the other invites a mismatch between
 * what was validated and what gets used.
 */
export function parseBundle(input: unknown): ParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`bundle: not valid JSON (${String(err)})`] };
    }
  }

  const e = new Errors();
  if (!isRecord(value)) {
    return { ok: false, errors: ['bundle: expected an object'] };
  }
  // Version first: on a mismatch every other message would be noise about
  // fields that legitimately moved.
  if (value.schema !== BUNDLE_SCHEMA) {
    return {
      ok: false,
      errors: [
        `bundle.schema: expected ${BUNDLE_SCHEMA}, got ${JSON.stringify(value.schema)}`,
      ],
    };
  }
  if (!isNonEmptyString(value.sessionId)) {
    e.bad('bundle.sessionId', 'expected a non-empty string');
  }
  if (!isFiniteNumber(value.createdAt)) {
    e.bad('bundle.createdAt', 'expected a finite number');
  }
  const env = parseEnv(value.env, 'bundle.env', e);

  // AN EMPTY BUNDLE IS REFUSED, matching `report-bundle.mjs`. The two validators
  // disagreed here: this one returned `{ ok: true, items: [] }` for a bundle the
  // pipeline rejects, so a batch whose every item was discarded would have been
  // written to disk, cleared from the session, and then refused downstream — a
  // report destroyed behind a success message.
  if (Array.isArray(value.items) && value.items.length === 0) {
    e.bad('bundle.items', 'expected at least one item');
  }
  if (!Array.isArray(value.items)) {
    e.bad('bundle.items', 'expected an array');
    return { ok: false, errors: e.list };
  }
  const items: DebugItem[] = [];
  const ids = new Set<string>();
  value.items.forEach((raw, i) => {
    const item = parseItem(raw, `bundle.items[${i}]`, e);
    if (!item) return;
    if (ids.has(item.id)) {
      e.bad(`bundle.items[${i}].id`, `duplicate item id ${item.id}`);
      return;
    }
    ids.add(item.id);
    items.push(item);
  });

  let groups: ProposedGroup[] | undefined;
  if (value.groups !== undefined) {
    groups = parseGroups(value.groups, 'bundle.groups', ids, e);
  }

  if (e.list.length > 0 || !env) return { ok: false, errors: e.list };
  return {
    ok: true,
    bundle: {
      schema: BUNDLE_SCHEMA,
      sessionId: value.sessionId as string,
      createdAt: value.createdAt as number,
      env,
      items,
      ...(groups ? { groups } : {}),
    },
  };
}
