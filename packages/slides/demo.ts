import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  initializeEditor,
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
  const slideId = store.addSlide('blank');
  // A starter rectangle the user can drag around immediately.
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 200, y: 200, w: 400, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: '#3a7' },
  });
});

const editor = initializeEditor({
  canvas, overlay, store,
  hostWidth: HOST_W, hostHeight: HOST_H, dpr: DPR,
});

// Toolbar wiring.
const toolbar = document.getElementById('toolbar') as HTMLDivElement;
toolbar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const insert = target.dataset.insert as InsertKind | undefined;
  if (!insert) return;
  // Toggle: clicking the same button again exits insert mode.
  const wasActive = target.classList.contains('active');
  toolbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  if (wasActive) {
    editor.setInsertMode(null);
  } else {
    target.classList.add('active');
    editor.setInsertMode(insert);
  }
});

// Drive an animation-frame loop so async asset loads (image cache)
// repaint when ready.
function tick(): void {
  editor.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

void SLIDE_HEIGHT; // suppress unused-import warning
void SLIDE_WIDTH;
