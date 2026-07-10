/**
 * Placeholder inheritance key `"{type}:{idx}"`, shared by the layout parser
 * (which stores per-placeholder font sizes / frames) and the slide parser
 * (which looks them up). OOXML uses different `<p:ph type>` tokens for the
 * same logical placeholder on the layout vs the slide — most commonly a
 * title slide whose layout stores `ctrTitle` while the slide references
 * `title`. Normalizing those aliases keeps storage and lookup keys aligned;
 * otherwise the slide placeholder finds no layout default and collapses to
 * the docs-renderer font fallback / a `(0,0,0,0)` frame.
 */
const PH_TYPE_ALIAS: Record<string, string> = {
  ctrTitle: 'title',
};

export function phKey(rawType: string, idx: string): string {
  return `${PH_TYPE_ALIAS[rawType] ?? rawType}:${idx}`;
}
