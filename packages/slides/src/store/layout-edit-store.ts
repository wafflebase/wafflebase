import type { Block } from '@wafflebase/docs';
import type {
  Background,
  GuideAxis,
  SlideAnimation,
  SlideTransition,
  SlidesDocument,
} from '../model/presentation';
import type {
  ArrowheadStyle,
  ConnectorRouting,
  Endpoint,
} from '../model/connector';
import type {
  CellStyle,
  ElementInit,
  Frame,
  ObjectAnimation,
  PlaceholderRef,
  Stroke,
} from '../model/element';
import type { Master } from '../model/master';
import type { Theme } from '../model/theme';
import {
  buildLayoutSlide,
  getLayout,
  parsePlaceholderElementId,
} from '../model/layout';
import type {
  LayoutPatch,
  MasterPatch,
  SlidesStore,
  ThemePatch,
} from './store';

/**
 * LayoutEditStore — the "virtual-slide gate" for canvas layout-editing
 * mode (PR3 commit 5).
 *
 * Wraps the real `SlidesStore` plus a current layout id. It presents the
 * editor with a single synthetic slide (`buildLayoutSlide`) so the
 * existing drag / resize / snap / overlay machinery edits a layout's
 * placeholders, and routes the only geometry commit the editor makes
 * (`updateElementFrame`) to `updateLayoutPlaceholderFrame` on the real
 * store. Everything that would mutate slide content is a guarded no-op,
 * so a layout edit can never leak into a real slide. `batch`, undo/redo,
 * and `onChange` delegate to the real store, so one drag is one undo unit
 * and layout edits repaint live slides through the real store's cascade.
 *
 * Theme-builder mutations (`updateTheme` / `updateMaster` / `updateLayout`
 * / `updateLayoutPlaceholderFrame`) delegate straight through — they are
 * the panel's edit surface and are safe in this mode.
 */
export class LayoutEditStore implements SlidesStore {
  constructor(
    private readonly real: SlidesStore,
    private layoutId: string,
  ) {}

  setLayoutId(layoutId: string): void {
    this.layoutId = layoutId;
  }

  getLayoutId(): string {
    return this.layoutId;
  }

  // --- read: serve the synthetic layout slide ---

  read(): SlidesDocument {
    const doc = this.real.read();
    const layout =
      doc.layouts.find((l) => l.id === this.layoutId) ?? getLayout(this.layoutId);
    const master = this.resolveMaster(doc);
    const theme = this.resolveTheme(doc);
    return { ...doc, slides: [buildLayoutSlide(layout, master, theme)] };
  }

  private resolveMaster(doc: SlidesDocument): Master {
    return (
      doc.masters.find((m) => m.id === doc.meta.masterId) ?? doc.masters[0]
    );
  }

  private resolveTheme(doc: SlidesDocument): Theme {
    return doc.themes.find((t) => t.id === doc.meta.themeId) ?? doc.themes[0];
  }

  // --- geometry commit: route to the layout placeholder ---

  updateElementFrame(
    _slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void {
    // The synthetic element id deterministically encodes its slot, so we
    // recover the ref by parsing rather than rebuilding the synthetic slide
    // on every drag/resize/nudge commit.
    const ref = parsePlaceholderElementId(elementId);
    if (!ref) return; // unknown / non-placeholder element → inert
    this.real.updateLayoutPlaceholderFrame(this.layoutId, ref, frame);
  }

  // --- theme-builder mutations: delegate (panel edit surface) ---

  addTheme(theme: Theme): void {
    this.real.addTheme(theme);
  }
  applyTheme(themeId: string): void {
    this.real.applyTheme(themeId);
  }
  updateTheme(themeId: string, patch: ThemePatch): void {
    this.real.updateTheme(themeId, patch);
  }
  updateMaster(masterId: string, patch: MasterPatch): void {
    this.real.updateMaster(masterId, patch);
  }
  updateLayout(layoutId: string, patch: LayoutPatch): void {
    this.real.updateLayout(layoutId, patch);
  }
  updateLayoutPlaceholderFrame(
    layoutId: string,
    ref: PlaceholderRef,
    frame: Partial<Frame>,
  ): void {
    this.real.updateLayoutPlaceholderFrame(layoutId, ref, frame);
  }
  setUnit(unit: 'in' | 'cm'): void {
    this.real.setUnit(unit);
  }
  pushRecentColor(hex: string): void {
    this.real.pushRecentColor(hex);
  }

  // --- transactions / notifications / history: delegate ---

  batch(fn: () => void): void {
    this.real.batch(fn);
  }
  onChange(cb: () => void): () => void {
    return this.real.onChange?.(cb) ?? (() => undefined);
  }
  undo(): void {
    this.real.undo();
  }
  redo(): void {
    this.real.redo();
  }
  canUndo(): boolean {
    return this.real.canUndo();
  }
  canRedo(): boolean {
    return this.real.canRedo();
  }

  // --- structural mutations: guarded no-ops ---
  // Layout-edit mode only repositions placeholders. Everything below is
  // inert so a layout edit can never create or mutate a persisted slide.

  addSlide(_layoutId: string, _atIndex?: number): string {
    return '';
  }
  duplicateSlide(_slideId: string): string {
    return '';
  }
  removeSlide(_slideId: string): void {}
  removeSlides(_slideIds: string[]): void {}
  moveSlide(_slideId: string, _toIndex: number): void {}
  moveSlides(_slideIds: string[], _toIndex: number): void {}
  updateSlideBackground(_slideId: string, _bg: Background): void {}
  applyLayout(_slideId: string, _layoutId: string): void {}
  setSlideTransition(
    _slideId: string,
    _transition: SlideTransition | undefined,
  ): void {}
  addAnimation(_slideId: string, _anim: SlideAnimation): string {
    return '';
  }
  updateAnimation(
    _slideId: string,
    _animId: string,
    _patch: Partial<ObjectAnimation>,
  ): void {}
  removeAnimation(_slideId: string, _animId: string): void {}
  reorderAnimation(_slideId: string, _animId: string, _toIndex: number): void {}

  addElement(
    _slideId: string,
    _init: ElementInit,
    _parentGroupId?: string,
  ): string {
    return '';
  }
  removeElement(_slideId: string, _elementId: string): void {}
  removeElements(_slideId: string, _elementIds: string[]): void {}
  updateElementData(_slideId: string, _elementId: string, _patch: object): void {}
  reorderElement(_slideId: string, _elementId: string, _toIndex: number): void {}

  group(
    _slideId: string,
    _elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] } {
    return { groupId: '', excludedConnectorIds: [] };
  }
  ungroup(_slideId: string, _groupId: string): string[] {
    return [];
  }
  refitGroup(_slideId: string, _groupId: string): void {}
  bakeGroupResize(_slideId: string, _groupId: string): void {}

  updateConnectorEndpoint(
    _slideId: string,
    _elementId: string,
    _side: 'start' | 'end',
    _endpoint: Endpoint,
  ): void {}
  updateConnectorArrowheads(
    _slideId: string,
    _elementId: string,
    _heads: { start?: ArrowheadStyle | null; end?: ArrowheadStyle | null },
  ): void {}
  updateConnectorStroke(
    _slideId: string,
    _elementId: string,
    _stroke: Stroke | undefined,
  ): void {}
  updateConnectorRouting(
    _slideId: string,
    _elementId: string,
    _routing: ConnectorRouting,
  ): void {}
  updateConnectorElbowBend(
    _slideId: string,
    _elementId: string,
    _bend: number | undefined,
  ): void {}
  updateConnectorCurveBend(
    _slideId: string,
    _elementId: string,
    _bend: number | undefined,
  ): void {}

  addGuide(_axis: GuideAxis, _position: number): string {
    return '';
  }
  moveGuide(_id: string, _position: number): void {}
  removeGuide(_id: string): void {}

  withTextElement(
    _slideId: string,
    _elementId: string,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {}
  withShapeText(
    _slideId: string,
    _elementId: string,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {}
  withTableCellBody(
    _slideId: string,
    _elementId: string,
    _row: number,
    _col: number,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {}
  insertTableRow(_slideId: string, _elementId: string, _atIndex: number): void {}
  insertTableColumn(
    _slideId: string,
    _elementId: string,
    _atIndex: number,
  ): void {}
  deleteTableRow(_slideId: string, _elementId: string, _atIndex: number): void {}
  deleteTableColumn(
    _slideId: string,
    _elementId: string,
    _atIndex: number,
  ): void {}
  mergeTableCells(
    _slideId: string,
    _elementId: string,
    _range: { r0: number; c0: number; r1: number; c1: number },
  ): void {}
  unmergeTableCells(
    _slideId: string,
    _elementId: string,
    _anchor: { row: number; col: number },
  ): void {}
  updateTableCellStyle(
    _slideId: string,
    _elementId: string,
    _row: number,
    _col: number,
    _patch: Partial<CellStyle>,
  ): void {}
  updateTableColumnWidths(
    _slideId: string,
    _elementId: string,
    _widths: readonly number[],
  ): void {}
  updateTableRowHeights(
    _slideId: string,
    _elementId: string,
    _heights: readonly number[],
  ): void {}
  withNotes(
    _slideId: string,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {}
}
