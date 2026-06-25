import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { buildCloud } from '../basic/cloud';
import { pointTailHandle } from './handles';
import { cat2, mod3, sat2 } from './ooxml-math';

/**
 * `cloudCallout` — cloud silhouette plus three small "thought-bubble"
 * connector circles trailing toward the tip (xPos, yPos). Faithful port
 * of the ECMA-376 preset.
 *
 * Adjustments (`CLOUD_CALLOUT_ADJUSTMENTS`):
 *   [0] adj1 — tip x, thousandths of `w` from centre. Default -20833.
 *   [1] adj2 — tip y, thousandths of `h` from centre. Default 62500.
 *
 * The three bubbles march from the cloud edge to the tip with radii
 * `ss·1800/21600` (largest, nearest the cloud), `ss·1200/21600` (middle),
 * and `ss·600/21600` (smallest, at the tip). Their centres are the OOXML
 * tip-anchored offsets along the tip → cloud-edge vector, not a naive
 * fraction of the centre→tip line. The cloud body is delegated to
 * `buildCloud`; the bubbles are appended as full-circle sub-paths.
 */
export const CLOUD_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildCloudCallout: PathBuilder = ({ w, h }, adjustments) => {
  const path = new Path2D();
  path.addPath(buildCloud({ w, h }));

  const hc = w / 2;
  const vc = h / 2;
  const wd2 = w / 2;
  const hd2 = h / 2;
  const ss = Math.min(w, h);

  const dxPos = (w * adj(adjustments, 0, -20833)) / 100000;
  const dyPos = (h * adj(adjustments, 1, 62500)) / 100000;
  const xPos = hc + dxPos; // tip x
  const yPos = vc + dyPos; // tip y

  // Cloud-boundary point in the tip's direction (OOXML cat2/sat2 chain).
  const ht = cat2(hd2, dxPos, dyPos);
  const wt = sat2(wd2, dxPos, dyPos);
  const g4 = hc + cat2(wd2, ht, wt);
  const g5 = vc + sat2(hd2, ht, wt);
  // Vector tip → boundary and its length.
  const g6 = g4 - xPos;
  const g7 = g5 - yPos;
  const g8 = mod3(g6, g7, 0) || 1;

  const g9 = (ss * 6600) / 21600;
  const g11 = (g8 - g9) / 3;
  const g12 = (ss * 1800) / 21600; // largest bubble radius
  const g13 = g11 + g12; // middle-bubble offset from tip
  const g20 = (ss * 4800) / 21600 + 2 * g11; // largest-bubble offset from tip
  const g25 = (ss * 1200) / 21600; // middle bubble radius
  const g26 = (ss * 600) / 21600; // smallest bubble radius

  const bubbles: ReadonlyArray<readonly [number, number, number]> = [
    // [centreX, centreY, radius]
    [xPos + (g20 * g6) / g8, yPos + (g20 * g7) / g8, g12], // largest, near cloud
    [xPos + (g13 * g6) / g8, yPos + (g13 * g7) / g8, g25], // middle
    [xPos, yPos, g26], // smallest, at the tip
  ];
  for (const [bx, by, r] of bubbles) {
    path.moveTo(bx + r, by);
    path.arc(bx, by, r, 0, Math.PI * 2);
  }
  return path;
};

export const CLOUD_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    CLOUD_CALLOUT_ADJUSTMENTS[0],
    CLOUD_CALLOUT_ADJUSTMENTS[1],
  ),
];
