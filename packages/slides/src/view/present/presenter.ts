import type { Slide, SlidesDocument } from '../../model/presentation';

/**
 * Options for `startPresenter`. The presenter mounts a canvas inside
 * `container`, listens for input, and tears everything down on
 * `dispose`. v1 is local-only — no Yorkie presence broadcast.
 */
export interface PresenterOptions {
  container: HTMLElement;
  doc: SlidesDocument;
  startSlideId: string;
  onExit: () => void;
}

/**
 * Public handle returned by `startPresenter`. The methods exposed
 * here are the only ones safe to call from the React shell. Internal
 * navigation methods (`next` / `prev` / `goToFirst` / `goToLast`)
 * are not part of the public surface — they're driven by the
 * presenter's own input handlers in later tasks.
 */
export interface Presenter {
  setDocument(doc: SlidesDocument): void;
  getCurrentSlideId(): string | null;
  isAtEndScreen(): boolean;
  dispose(): void;
}

interface PresenterState {
  doc: SlidesDocument;
  slides: readonly Slide[];
  /** `null` only when `atEndScreen` is true. */
  currentSlideId: string | null;
  atEndScreen: boolean;
}

export function startPresenter(options: PresenterOptions): Presenter {
  const state: PresenterState = {
    doc: options.doc,
    slides: options.doc.slides,
    currentSlideId: options.startSlideId,
    atEndScreen: false,
  };

  let disposed = false;

  /**
   * Render stub. Task 2 fills this in with the canvas + SlideRenderer
   * integration. Task 1 only needs the state machine.
   */
  function paint(): void {
    // no-op — render lands in Task 2.
  }

  function indexOfCurrent(): number {
    if (state.currentSlideId === null) return -1;
    return state.slides.findIndex((s) => s.id === state.currentSlideId);
  }

  function next(): void {
    if (disposed) return;
    if (state.atEndScreen) return;
    const idx = indexOfCurrent();
    if (idx < 0) return;
    if (idx < state.slides.length - 1) {
      state.currentSlideId = state.slides[idx + 1].id;
    } else {
      state.atEndScreen = true;
      state.currentSlideId = null;
    }
    paint();
  }

  function prev(): void {
    if (disposed) return;
    if (state.atEndScreen) {
      state.atEndScreen = false;
      state.currentSlideId = state.slides[state.slides.length - 1].id;
      paint();
      return;
    }
    const idx = indexOfCurrent();
    if (idx < 0) return;
    const targetIdx = Math.max(0, idx - 1);
    state.currentSlideId = state.slides[targetIdx].id;
    paint();
  }

  function goToFirst(): void {
    if (disposed) return;
    state.currentSlideId = state.slides[0].id;
    state.atEndScreen = false;
    paint();
  }

  function goToLast(): void {
    if (disposed) return;
    state.currentSlideId = state.slides[state.slides.length - 1].id;
    state.atEndScreen = false;
    paint();
  }

  function setDocument(doc: SlidesDocument): void {
    if (disposed) return;
    // Task 5 will flesh this out with deletion / reindex logic.
    state.doc = doc;
    state.slides = doc.slides;
    paint();
  }

  function getCurrentSlideId(): string | null {
    return state.currentSlideId;
  }

  function isAtEndScreen(): boolean {
    return state.atEndScreen;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Task 6 will tear down canvas, listeners, fullscreen, etc.
  }

  const presenter: Presenter = {
    setDocument,
    getCurrentSlideId,
    isAtEndScreen,
    dispose,
  };

  // Internal-only handle so unit tests can exercise navigation
  // without going through DOM events. Not part of the public type;
  // not enumerable. Later tasks (input wiring, remote-change tests)
  // still want to drive navigation directly, so this stays.
  Object.defineProperty(presenter, '__test', {
    enumerable: false,
    value: { next, prev, goToFirst, goToLast },
  });

  return presenter;
}
