type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  // Reject short-form (#fff), alpha-bearing (#RRGGBBAA), or non-hex inputs.
  // Without this, parseInt of `NaN` propagates and contrastRatio quietly
  // returns garbage instead of surfacing the malformed input.
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) {
    throw new Error(`contrast helper: unsupported hex format "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

// Parse `oklch(L C H)` or `oklch(L C H / a)` to sRGB.
// L is in [0,1], C is chroma (~0–0.4), H is degrees.
function oklchToRgb(input: string): RGB {
  const inside = input.replace(/^oklch\(/, '').replace(/\)$/, '');
  const [lchPart] = inside.split('/');
  const [lRaw, cRaw, hRaw] = lchPart.trim().split(/\s+/);
  const L = parseFloat(lRaw);
  const C = parseFloat(cRaw);
  const H = (parseFloat(hRaw) * Math.PI) / 180;
  // OKLab -> linear sRGB. Reference: https://bottosson.github.io/posts/oklab/
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;
  const rLinear = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLinear = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLinear = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  const compand = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return {
    r: Math.max(0, Math.min(1, compand(rLinear))),
    g: Math.max(0, Math.min(1, compand(gLinear))),
    b: Math.max(0, Math.min(1, compand(bLinear))),
  };
}

function parseColor(input: string): RGB {
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) return hexToRgb(trimmed);
  if (trimmed.startsWith('oklch(')) return oklchToRgb(trimmed);
  throw new Error(`contrast helper: unsupported color format "${input}"`);
}

function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const lf = relativeLuminance(parseColor(foreground));
  const lb = relativeLuminance(parseColor(background));
  const [lighter, darker] = lf > lb ? [lf, lb] : [lb, lf];
  return (lighter + 0.05) / (darker + 0.05);
}
