import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AGENT_GRID_GAP,
  DEFAULT_SECTION_SIZE,
  DEFAULT_STICKY_SIZE,
  SECTION_COLORS,
  STICKY_COLORS,
  besideContent,
  besideFrame,
  buildSectionInit,
  buildStickyInit,
  buildTextBoxInit,
  estimateTextHeight,
  findFreeRect,
  frameAroundIds,
  gridColumns,
  gridOrigins,
  gridSize,
  isSectionElement,
  planGridSection,
  planMoves,
  sectionInsertIndex,
  sectionMemberIds,
  summarizeBoard,
  TEXT_BOX_WIDTH,
  type BoardElementSummary,
  type BoardRitualsView,
  type MovePlan,
  type MoveSpec,
  type SectionColor,
  type Side,
} from '@wafflebase/board';
import {
  generateId,
  type Element,
  type ElementInit,
  type Frame,
  type Point,
} from '@wafflebase/slides';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { DocumentService } from '../../document/document.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import { UserService } from '../../user/user.service';
import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';
import { unwrapJson } from '../../yorkie/yorkie-json';
import type { AuthenticatedRequest } from '../../auth/auth.types';

const BOARD_KEY_PREFIX = YORKIE_DOC_KEY_PREFIXES.board;

/** Largest |coordinate| accepted — far beyond any board, short of float trouble. */
const MAX_COORD = 10_000_000;
/** Largest width / height accepted for an element. */
const MAX_SIZE = 100_000;
/** Most elements one request may create or move. */
const MAX_BATCH = 500;
/** Longest text one sticky or text box may carry. */
const MAX_TEXT = 10_000;
/** Text-box font sizes accepted, in the slides text unit. */
const MIN_FONT = 6;
const MAX_FONT = 200;

/** The board root keys these endpoints read. Every field optional. */
interface BoardRoot extends Record<string, unknown> {
  meta?: { title?: string; anonymous?: boolean };
  elements?: Element[];
  stamps?: BoardRitualsView['stamps'];
  voting?: BoardRitualsView['voting'];
}

/** A proxied Yorkie array of elements, as `doc.update` hands it out. */
interface ElementArrayLike {
  length: number;
  [index: number]: Record<string, unknown>;
  push(item: unknown): number;
  splice(start: number, deleteCount: number, ...items: unknown[]): unknown;
}

interface BoardState {
  elements: Element[];
  rituals: BoardRitualsView;
}

/**
 * Granular board editing for agents — the AI half of a FigJam-style
 * brainstorm done through the API instead of a model built into the app
 * (PRODUCT.md principle 4: agents and people edit the same thing).
 *
 * An agent reads the board's stickies (`GET .../board/elements`), clusters
 * them by theme into sections (`POST .../board/sections`, optionally laying
 * the members out as a grid), arranges (`PATCH .../board/elements`) and writes
 * a summary (`POST .../board/text`). Every element is built by the same
 * `@wafflebase/board` factory the canvas uses, so an agent's sticky and a
 * person's are indistinguishable; and every request lands as **one**
 * `doc.update` of granular writes — a `push` / `splice` for new elements, a
 * field assignment for a moved one — so a collaborator editing any other
 * element concurrently is never overwritten, which `PUT .../content` (a whole
 * root replace) cannot promise.
 *
 * Authorization is the v1 content endpoints': `WorkspaceScopeGuard` +
 * `getDocumentOrThrow` (a document in another workspace, or trashed, is a 404,
 * never a 403) and `ApiKeyWriteScopeGuard` on every mutating verb.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/board')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1BoardController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieService: YorkieService,
    private readonly userService: UserService,
  ) {}

  private async assertBoardDocument(workspaceId: string, documentId: string) {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (meta.type !== 'board') {
      throw new BadRequestException(
        `Board operations are only available on board documents; ` +
          `"${documentId}" is a "${meta.type}" document.`,
      );
    }
  }

  @Get('elements')
  async elements(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<{ elements: BoardElementSummary[] }> {
    await this.assertBoardDocument(workspaceId, documentId);
    const elements = await this.yorkieService.withDocument<
      BoardElementSummary[],
      BoardRoot
    >(
      documentId,
      (doc) => {
        const state = readState(doc.getRoot());
        return summarizeBoard(state.elements, state.rituals);
      },
      { docKeyPrefix: BOARD_KEY_PREFIX, syncMode: 'readonly' },
    );
    return { elements };
  }

  /**
   * Add stickies. Either `[{ text, color?, x?, y? }]` — each with its own
   * top-left, or laid out as a grid in free space when it has none — or
   * `{ texts: [...], color?, near?, columns? }`, a grid placed beside the
   * element `near` names (an id) or around a point (`{ x, y }`), or beside
   * the existing content when `near` is absent.
   */
  @Post('stickies')
  async addStickies(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ ids: string[] }> {
    await this.assertBoardDocument(workspaceId, documentId);
    const input = parseStickiesBody(body);
    const author = await this.authorName(req);

    return this.yorkieService.withDocument<{ ids: string[] }, BoardRoot>(
      documentId,
      (doc) => {
        const state = readState(doc.getRoot());
        const occupied = state.elements.map((el) => el.frame);
        const size = DEFAULT_STICKY_SIZE;

        const unplaced = input.items.filter((it) => it.at === undefined);
        let origins: Point[] = [];
        if (unplaced.length > 0) {
          const columns = input.columns ?? gridColumns(unplaced.length);
          const outer = gridSize(
            unplaced.length,
            size,
            columns,
            AGENT_GRID_GAP,
          );
          const aim = aimFor(input.near, state.elements, occupied, outer);
          const topLeft = findFreeRect(occupied, outer, aim);
          origins = gridOrigins(
            unplaced.length,
            topLeft,
            size,
            columns,
            AGENT_GRID_GAP,
          );
        }

        const anonymous = state.rituals.anonymous === true;
        let next = 0;
        const inits: ElementInit[] = input.items.map((it) => {
          const topLeft = it.at ?? origins[next++];
          return buildStickyInit(
            it.color ?? input.color ?? STICKY_COLORS[0].value,
            { x: topLeft.x + size.w / 2, y: topLeft.y + size.h / 2 },
            {
              text: it.text,
              ...(author && !anonymous ? { author } : {}),
            },
          );
        });

        const ids: string[] = [];
        doc.update((root) => {
          const elements = ensureElements(root);
          for (const init of inits) {
            const id = generateId();
            elements.push({ ...init, id });
            ids.push(id);
          }
        });
        return { ids };
      },
      { docKeyPrefix: BOARD_KEY_PREFIX },
    );
  }

  /**
   * Add a section titled `title`. With `elementIds` it wraps them where they
   * are (the canvas's "wrap selection in section"), or — with
   * `layout: 'grid'` — first lays them out as a grid in free space (or at
   * `at`) and wraps that, which is the one-call "cluster these". With
   * `frame` it fills that frame; with neither, a default-size section goes
   * in free space. Placed in the z-order behind ordinary elements and
   * smaller sections, as the section tool places it.
   */
  @Post('sections')
  async addSection(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; frame: Frame; members: string[]; moved: string[] }> {
    await this.assertBoardDocument(workspaceId, documentId);
    const input = parseSectionBody(body);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const state = readState(doc.getRoot());
        const elements = state.elements;
        let frame: Frame | undefined;
        let plan: Extract<MovePlan, { ok: true }> | undefined;

        if (input.elementIds) {
          const known = new Set(elements.map((el) => el.id));
          const missing = input.elementIds.filter((id) => !known.has(id));
          if (missing.length > 0) {
            throw new NotFoundException(
              `Element not found: ${missing.join(', ')}`,
            );
          }
          if (input.grid) {
            const nested = input.elementIds.filter((id) =>
              isSectionElement(elements.find((el) => el.id === id)),
            );
            if (nested.length > 0) {
              throw new BadRequestException(
                `A grid layout arranges ordinary elements; ${nested.join(', ')} ` +
                  `is a section. Wrap it without "layout": "grid" instead.`,
              );
            }
            const grid = planGridSection(elements, input.elementIds, {
              at: input.at,
              columns: input.columns,
            });
            plan = requirePlan(planMoves(elements, grid.moves));
            frame = grid.frame;
          } else {
            frame = frameAroundIds(elements, input.elementIds);
          }
        } else if (input.frame) {
          frame = input.frame;
        } else {
          const size = DEFAULT_SECTION_SIZE;
          const occupied = elements.map((el) => el.frame);
          const at =
            input.at ?? findFreeRect(occupied, size, besideContent(occupied));
          frame = { x: at.x, y: at.y, w: size.w, h: size.h, rotation: 0 };
        }
        if (!frame) throw new BadRequestException('Nothing to wrap');

        const after = applyPlanToPlain(elements, plan);
        const index = sectionInsertIndex(after, frame);
        const init = buildSectionInit(frame, {
          title: input.title,
          color: input.color,
        });
        const id = generateId();

        doc.update((root) => {
          const arr = ensureElements(root);
          if (plan) writePlan(arr, plan);
          arr.splice(Math.min(index, arr.length), 0, { ...init, id });
        });

        const section = { ...init, id } as Element;
        const members = sectionMemberIds([...after, section], section);
        return {
          id,
          frame,
          members,
          moved: plan ? [...plan.moved, ...plan.carried] : [],
        };
      },
      { docKeyPrefix: BOARD_KEY_PREFIX },
    );
  }

  /**
   * Batch move / resize: `[{ id, x, y, w?, h? }]` (or `{ moves: [...] }`).
   * A section that moves carries its members, as a drag on the canvas does;
   * glued connectors follow. All-or-nothing: an unknown id is a 404, a
   * connector a 400, a locked section (or anything in one) a 409, and nothing
   * is written.
   */
  @Patch('elements')
  async moveElements(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<{ moved: string[]; carried: string[] }> {
    await this.assertBoardDocument(workspaceId, documentId);
    const moves = parseMovesBody(body);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const state = readState(doc.getRoot());
        const plan = requirePlan(planMoves(state.elements, moves));
        doc.update((root) => writePlan(ensureElements(root), plan));
        return { moved: plan.moved, carried: plan.carried };
      },
      { docKeyPrefix: BOARD_KEY_PREFIX },
    );
  }

  /**
   * Add a text box — a summary, a heading. At `x`/`y` (top-left) when given,
   * else beside the element `near` names (`side`: right, the default, left,
   * below or above), else beside the existing content; moved off anything it
   * would cover.
   */
  @Post('text')
  async addText(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; frame: Frame }> {
    await this.assertBoardDocument(workspaceId, documentId);
    const input = parseTextBody(body);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const state = readState(doc.getRoot());
        const w = input.w ?? TEXT_BOX_WIDTH;
        const h = estimateTextHeight(input.text, w, input.fontSize);
        let at = input.at;
        if (!at) {
          const occupied = state.elements.map((el) => el.frame);
          let aim: Point;
          if (input.near !== undefined) {
            const target = state.elements.find((el) => el.id === input.near);
            if (!target)
              throw new NotFoundException(`Element not found: ${input.near}`);
            aim = besideFrame(target.frame, { w, h }, input.side);
          } else {
            aim = besideContent(occupied);
          }
          at = findFreeRect(occupied, { w, h }, aim);
        }
        const init = buildTextBoxInit(input.text, at, {
          w,
          h,
          fontSize: input.fontSize,
          bold: input.bold,
        });
        const id = generateId();
        doc.update((root) => {
          ensureElements(root).push({ ...init, id });
        });
        return { id, frame: init.frame };
      },
      { docKeyPrefix: BOARD_KEY_PREFIX },
    );
  }

  /**
   * The display name stamped on a new sticky, as the canvas stamps the
   * signed-in user's. An API-key caller carries only an id, so it is looked
   * up; a key whose creator was deleted writes an unattributed sticky rather
   * than failing — an author tag is decoration, not provenance.
   */
  private async authorName(
    req: AuthenticatedRequest,
  ): Promise<string | undefined> {
    const name = req.user?.username;
    if (typeof name === 'string' && name.length > 0) return name;
    if (req.user?.id === undefined) return undefined;
    const user = await this.userService.user({ id: req.user.id });
    return user?.username || undefined;
  }
}

// --- reading -----------------------------------------------------------------

function readState(root: BoardRoot): BoardState {
  const meta = unwrapJson<BoardRoot['meta']>(root.meta);
  return {
    elements: unwrapJson<Element[]>(root.elements) ?? [],
    rituals: {
      stamps: unwrapJson<BoardRitualsView['stamps']>(root.stamps),
      voting: unwrapJson<BoardRitualsView['voting']>(root.voting),
      anonymous: meta?.anonymous === true,
    },
  };
}

function ensureElements(root: BoardRoot): ElementArrayLike {
  if (!root.elements) root.elements = [];
  return root.elements as unknown as ElementArrayLike;
}

// --- writing -----------------------------------------------------------------

function requirePlan(plan: MovePlan): Extract<MovePlan, { ok: true }> {
  if (plan.ok) return plan;
  const ids = plan.ids.join(', ');
  switch (plan.reason) {
    case 'not_found':
      throw new NotFoundException(`Element not found: ${ids}`);
    case 'duplicate':
      throw new BadRequestException(
        `An element is moved twice in one batch: ${ids}`,
      );
    case 'connector':
      throw new BadRequestException(
        `A connector's frame follows its ends; move what it connects instead: ${ids}`,
      );
    case 'locked':
      throw new ConflictException(
        `Locked sections and their contents cannot be moved; unlock them first: ${ids}`,
      );
  }
}

function applyPlanToPlain(
  elements: Element[],
  plan: Extract<MovePlan, { ok: true }> | undefined,
): Element[] {
  if (!plan) return elements;
  const changed = new Map(plan.changed.map((el) => [el.id, el]));
  return elements.map((el) => changed.get(el.id) ?? el);
}

/**
 * Land a move plan as field writes on the live array: a fresh `frame` per
 * changed element, plus a connector's `start` / `end` (a carried free end
 * moves). Never an assignment of the array or of a whole element, so a peer's
 * concurrent edit to any other field survives.
 */
function writePlan(
  arr: ElementArrayLike,
  plan: Extract<MovePlan, { ok: true }>,
) {
  const index = new Map<string, number>();
  for (let i = 0; i < arr.length; i++) index.set(String(arr[i].id), i);
  for (const el of plan.changed) {
    const i = index.get(el.id);
    if (i === undefined) continue;
    const target = arr[i];
    target.frame = { ...el.frame };
    if (el.type === 'connector') {
      target.start = { ...el.start };
      target.end = { ...el.end };
    }
  }
}

// --- request parsing ---------------------------------------------------------

interface StickyItem {
  text: string;
  color?: string;
  at?: Point;
}

type Near = string | Point | undefined;

function aimFor(
  near: Near,
  elements: readonly Element[],
  occupied: readonly Frame[],
  outer: { w: number; h: number },
): Point {
  if (typeof near === 'string') {
    const target = elements.find((el) => el.id === near);
    if (!target) throw new NotFoundException(`Element not found: ${near}`);
    return besideFrame(target.frame, outer, 'right');
  }
  if (near) return { x: near.x - outer.w / 2, y: near.y - outer.h / 2 };
  return besideContent(occupied);
}

function asObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(`${what} must be a JSON object`);
  }
  return body as Record<string, unknown>;
}

function coord(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_COORD
  ) {
    throw new BadRequestException(
      `'${name}' must be a finite number within ±${MAX_COORD}`,
    );
  }
  return value;
}

function size(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_SIZE
  ) {
    throw new BadRequestException(
      `'${name}' must be a number in (0, ${MAX_SIZE}]`,
    );
  }
  return value;
}

function optionalSize(value: unknown, name: string): number | undefined {
  return value === undefined || value === null ? undefined : size(value, name);
}

function text(value: unknown, name: string, allowEmpty = true): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`'${name}' must be a string`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new BadRequestException(`'${name}' must not be empty`);
  }
  if (value.length > MAX_TEXT) {
    throw new BadRequestException(
      `'${name}' is longer than ${MAX_TEXT} characters`,
    );
  }
  return value;
}

function batch<T>(
  list: unknown[],
  name: string,
  each: (v: unknown, i: number) => T,
): T[] {
  if (list.length === 0)
    throw new BadRequestException(`'${name}' must not be empty`);
  if (list.length > MAX_BATCH) {
    throw new BadRequestException(
      `'${name}' holds more than ${MAX_BATCH} entries`,
    );
  }
  return list.map(each);
}

function optionalPoint(
  input: Record<string, unknown>,
  name: string,
): Point | undefined {
  const hasX = input.x !== undefined && input.x !== null;
  const hasY = input.y !== undefined && input.y !== null;
  if (!hasX && !hasY) return undefined;
  if (hasX !== hasY) {
    throw new BadRequestException(`${name}: give both 'x' and 'y', or neither`);
  }
  return { x: coord(input.x, 'x'), y: coord(input.y, 'y') };
}

function optionalColumns(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    throw new BadRequestException("'columns' must be an integer from 1 to 100");
  }
  return value;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A sticky colour: a palette name (`yellow`) or any `#RRGGBB`. */
function stickyColor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const named = STICKY_COLORS.find(
      (c) => c.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (named) return named.value;
    if (HEX.test(value.trim())) return value.trim().toUpperCase();
  }
  throw new BadRequestException(
    `'color' must be ${STICKY_COLORS.map((c) => c.name.toLowerCase()).join(' / ')} or #RRGGBB`,
  );
}

/** A section colour: a palette name or its fill hex — the body and border are a pair. */
function sectionColor(value: unknown): SectionColor | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    const found = SECTION_COLORS.find(
      (c) => c.name.toLowerCase() === v || c.fill.toLowerCase() === v,
    );
    if (found) return found;
  }
  throw new BadRequestException(
    `'color' must be one of ${SECTION_COLORS.map((c) => c.name.toLowerCase()).join(' / ')}`,
  );
}

function parseNear(value: unknown): Near {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const point = optionalPoint(value as Record<string, unknown>, 'near');
    if (point) return point;
  }
  throw new BadRequestException("'near' must be an element id or { x, y }");
}

function parseStickiesBody(body: unknown): {
  items: StickyItem[];
  color?: string;
  near: Near;
  columns?: number;
} {
  if (Array.isArray(body)) {
    const items = batch(body, 'stickies', (v, i) => {
      const o = asObject(v, `stickies[${i}]`);
      return {
        text: text(o.text ?? '', `stickies[${i}].text`),
        color: stickyColor(o.color),
        at: optionalPoint(o, `stickies[${i}]`),
      };
    });
    return { items, near: undefined };
  }
  const o = asObject(body, 'Request body');
  if (!Array.isArray(o.texts)) {
    throw new BadRequestException(
      'Body must be an array of { text, color?, x?, y? } or { texts: [...], color?, near?, columns? }',
    );
  }
  const items = batch(o.texts, 'texts', (v, i) => ({
    text: text(v, `texts[${i}]`),
  }));
  return {
    items,
    color: stickyColor(o.color),
    near: parseNear(o.near),
    columns: optionalColumns(o.columns),
  };
}

function parseFrame(value: unknown): Frame | undefined {
  if (value === undefined || value === null) return undefined;
  const o = asObject(value, "'frame'");
  return {
    x: coord(o.x, 'frame.x'),
    y: coord(o.y, 'frame.y'),
    w: size(o.w, 'frame.w'),
    h: size(o.h, 'frame.h'),
    rotation: 0,
  };
}

function parseSectionBody(body: unknown): {
  title: string;
  elementIds?: string[];
  frame?: Frame;
  color?: SectionColor;
  grid: boolean;
  at?: Point;
  columns?: number;
} {
  const o = asObject(body, 'Request body');
  const title = text(o.title, 'title', false).trim();
  let elementIds: string[] | undefined;
  if (o.elementIds !== undefined && o.elementIds !== null) {
    if (!Array.isArray(o.elementIds)) {
      throw new BadRequestException(
        "'elementIds' must be an array of element ids",
      );
    }
    elementIds = batch(o.elementIds, 'elementIds', (v, i) => {
      if (typeof v !== 'string' || v.length === 0) {
        throw new BadRequestException(
          `'elementIds[${i}]' must be an element id`,
        );
      }
      return v;
    });
    if (new Set(elementIds).size !== elementIds.length) {
      throw new BadRequestException("'elementIds' names an element twice");
    }
  }
  const frame = parseFrame(o.frame);
  if (elementIds && frame) {
    throw new BadRequestException("Give 'elementIds' or 'frame', not both");
  }
  if (
    o.layout !== undefined &&
    o.layout !== null &&
    o.layout !== 'grid' &&
    o.layout !== 'wrap'
  ) {
    throw new BadRequestException(
      "'layout' must be 'wrap' (default) or 'grid'",
    );
  }
  const grid = o.layout === 'grid';
  if (grid && !elementIds) {
    throw new BadRequestException(
      "'layout': 'grid' arranges 'elementIds'; give them",
    );
  }
  const at =
    o.at === undefined || o.at === null
      ? undefined
      : optionalPoint(asObject(o.at, "'at'"), 'at');
  return {
    title,
    elementIds,
    frame,
    color: sectionColor(o.color),
    grid,
    at,
    columns: optionalColumns(o.columns),
  };
}

function parseMovesBody(body: unknown): MoveSpec[] {
  let list: unknown = body;
  if (!Array.isArray(list)) {
    const o = asObject(body, 'Request body');
    list = o.moves;
    if (!Array.isArray(list)) {
      throw new BadRequestException(
        'Body must be an array of { id, x, y, w?, h? }',
      );
    }
  }
  return batch(list as unknown[], 'moves', (v, i) => {
    const o = asObject(v, `moves[${i}]`);
    if (typeof o.id !== 'string' || o.id.length === 0) {
      throw new BadRequestException(`'moves[${i}].id' must be an element id`);
    }
    const move: MoveSpec = { id: o.id, x: coord(o.x, 'x'), y: coord(o.y, 'y') };
    const w = optionalSize(o.w, 'w');
    const h = optionalSize(o.h, 'h');
    if (w !== undefined) move.w = w;
    if (h !== undefined) move.h = h;
    return move;
  });
}

const SIDES: readonly Side[] = ['right', 'left', 'below', 'above'];

function parseTextBody(body: unknown): {
  text: string;
  at?: Point;
  w?: number;
  fontSize?: number;
  bold?: boolean;
  near?: string;
  side?: Side;
} {
  const o = asObject(body, 'Request body');
  const out: ReturnType<typeof parseTextBody> = {
    text: text(o.text, 'text', false),
    at: optionalPoint(o, 'text'),
    w: optionalSize(o.w, 'w'),
  };
  if (o.fontSize !== undefined && o.fontSize !== null) {
    if (
      typeof o.fontSize !== 'number' ||
      !Number.isFinite(o.fontSize) ||
      o.fontSize < MIN_FONT ||
      o.fontSize > MAX_FONT
    ) {
      throw new BadRequestException(
        `'fontSize' must be a number from ${MIN_FONT} to ${MAX_FONT}`,
      );
    }
    out.fontSize = o.fontSize;
  }
  if (o.bold !== undefined && o.bold !== null) {
    if (typeof o.bold !== 'boolean')
      throw new BadRequestException("'bold' must be a boolean");
    out.bold = o.bold;
  }
  if (o.near !== undefined && o.near !== null) {
    if (typeof o.near !== 'string' || o.near.length === 0) {
      throw new BadRequestException("'near' must be an element id");
    }
    out.near = o.near;
  }
  if (o.side !== undefined && o.side !== null) {
    if (!SIDES.includes(o.side as Side)) {
      throw new BadRequestException(
        `'side' must be one of ${SIDES.join(' / ')}`,
      );
    }
    out.side = o.side as Side;
  }
  if (out.at && out.near) {
    throw new BadRequestException("Give 'x'/'y' or 'near', not both");
  }
  return out;
}
