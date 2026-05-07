import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  type InsertKind,
} from './src/index';

const HOST_W = 960;
const HOST_H = 540;
const DPR = window.devicePixelRatio || 1;

const canvas = document.getElementById('slide') as HTMLCanvasElement;
canvas.width = HOST_W * DPR;
canvas.height = HOST_H * DPR;
canvas.style.width = `${HOST_W}px`;
canvas.style.height = `${HOST_H}px`;

const overlay = document.getElementById('overlay') as HTMLDivElement;

const store = new MemSlidesStore();
store.batch(() => {
  // Slide 1: shapes
  const a = store.addSlide('blank');
  store.addElement(a, {
    type: 'shape',
    frame: { x: 200, y: 200, w: 400, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb', value: '#3a7' } },
  });
  // Slide 2: title layout
  store.addSlide('title');
  // Slide 3: blank
  store.addSlide('blank');
});

const editor = initializeEditor({
  canvas, overlay, store,
  hostWidth: HOST_W, hostHeight: HOST_H, dpr: DPR,
});

const thumbHandle = mountThumbnailPanel(
  document.getElementById('thumbnails') as HTMLDivElement,
  store, editor,
);

mountNotesPanel(
  document.getElementById('notes') as HTMLDivElement,
  store, editor,
);

const toolbar = document.getElementById('toolbar') as HTMLDivElement;
toolbar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const insert = target.dataset.insert as InsertKind | undefined;
  if (!insert) return;
  const wasActive = target.classList.contains('active');
  toolbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  if (wasActive) {
    editor.setInsertMode(null);
  } else {
    target.classList.add('active');
    editor.setInsertMode(insert);
  }
});

// Refresh thumbnails when the store changes (Cmd+D, paste, insert).
// Cheap: re-render every frame piggybacking on requestAnimationFrame.
let lastSlideCount = store.read().slides.length;
function tick(): void {
  editor.render();
  const count = store.read().slides.length;
  if (count !== lastSlideCount) {
    lastSlideCount = count;
    thumbHandle.refresh();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

void SLIDE_HEIGHT; void SLIDE_WIDTH;
