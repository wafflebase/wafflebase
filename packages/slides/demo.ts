// Vite dev demo. Wired up incrementally:
//   T1 — clears the canvas to a neutral colour so `pnpm slides dev`
//        runs end-to-end before any renderer ships.
//   T8 — replaced with a real fixture that exercises every renderer.

const canvas = document.getElementById('slide') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('No 2D context');

ctx.fillStyle = '#f5f5f5';
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = '#888';
ctx.font = '14px sans-serif';
ctx.fillText('Phase 2 demo placeholder — fixtures land in T8', 24, 32);
