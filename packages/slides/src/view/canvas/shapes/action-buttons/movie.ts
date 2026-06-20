import type { FrameSize } from '../builder';

/**
 * `actionButtonMovie` glyph — a movie-camera silhouette, transcribed
 * verbatim from the OOXML `actionButtonMovie` preset (a 19-vertex
 * polygon: camera body + lens + film-reel hump + tail). The preset
 * lays the glyph out in a centred `g13 = ¾·ss` square; each vertex is
 * stored as a fraction of that square's 21600-unit path box, then
 * scaled to the frame.
 */
const MOVIE_UNIT = 21600;
const MOVIE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 5280],
  [0, 9555],
  [1455, 9555],
  [1905, 9067],
  [2325, 9067],
  [2325, 15592],
  [17010, 15592],
  [17010, 13342],
  [19335, 13342],
  [20595, 14580],
  [21600, 14580],
  [21600, 6630],
  [20595, 6630],
  [19725, 7492],
  [17010, 7492],
  [17010, 6630],
  [16155, 5730],
  [1905, 5730],
  [1455, 5280],
];

export function buildMovieGlyph({ w, h }: FrameSize): Path2D {
  const ss = Math.min(w, h);
  const side = 0.75 * ss; // OOXML g13 = ¾·ss
  const left = w / 2 - side / 2; // centred icon box (g11)
  const top = h / 2 - side / 2; // (g9)
  const path = new Path2D();
  MOVIE_POINTS.forEach(([x, y], i) => {
    const px = left + (side * x) / MOVIE_UNIT;
    const py = top + (side * y) / MOVIE_UNIT;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
  return path;
}
