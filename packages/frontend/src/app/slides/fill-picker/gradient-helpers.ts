import type { GradientFill, GradientStop, ThemeColor, Theme } from '@wafflebase/slides';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((x, y) => x.pos - y.pos);
}

/** Resolve a stop color to a plain hex for interpolation; role colors fall
 *  back to a neutral so a fresh stop is at least visible (recolored after). */
function stopHex(color: ThemeColor): string {
  return color.kind === 'srgb' ? color.value : '#808080';
}

export function insertStopAt(stops: GradientStop[], pos: number): GradientStop[] {
  const p = clamp01(pos);
  const sorted = sortStops(stops);
  let left = sorted[0];
  let right = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].pos <= p && p <= sorted[i + 1].pos) {
      left = sorted[i];
      right = sorted[i + 1];
      break;
    }
  }
  const span = right.pos - left.pos || 1;
  const t = clamp01((p - left.pos) / span);
  const value = lerpHex(stopHex(left.color), stopHex(right.color), t);
  return sortStops([...sorted, { pos: p, color: { kind: 'srgb', value } }]);
}

export function removeStopAt(stops: GradientStop[], index: number): GradientStop[] {
  if (stops.length <= 2) return stops;
  return stops.filter((_, i) => i !== index);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Build a 2-stop linear gradient seeded from the current solid (or theme
 *  primary when none). Second stop is a lighter variant so the gradient is
 *  visible immediately. */
export function seedGradient(from: ThemeColor | undefined, theme: Theme): GradientFill {
  const base: ThemeColor = from ?? { kind: 'role', role: 'accent1' };
  const baseHex = base.kind === 'srgb' ? base.value : theme.colors[base.role] ?? '#4285f4';
  const light = lerpHex(baseHex, '#ffffff', 0.6);
  return {
    kind: 'gradient',
    type: 'linear',
    angle: Math.PI / 2, // top -> bottom, PowerPoint default
    stops: [
      { pos: 0, color: base },
      { pos: 1, color: { kind: 'srgb', value: light } },
    ],
  };
}
