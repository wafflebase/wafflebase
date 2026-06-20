/**
 * Counts surfaced to the user after a best-effort import. The toast on
 * the deck list reads from `summary()`; the CLI prints the same line.
 *
 * Fields are mutable — parsers bump counters as they encounter lossy
 * paths. Anything fully supported is *not* counted (a clean import
 * produces zeros).
 */
export class ImportReport {
  groupsFlattened = 0;
  shadowsDropped = 0;
  textBoxesPreScaled = 0;
  unknownShapes = 0;
  unknownLayoutTypes = 0;
  skippedImages = 0;
  transitionsApproximated = 0;

  // Note: `tablesFlattened`, `tableMergesIgnored`, and
  // `tableBordersApproximated` were retired alongside the structured
  // TableElement importer (P2 of slides-tables). Tables now round-trip
  // as a full structured element: there is no lossy path to count.

  summary(): string {
    const parts: string[] = [];
    if (this.groupsFlattened) parts.push(`${this.groupsFlattened} group(s) expanded`);
    if (this.shadowsDropped) parts.push(`${this.shadowsDropped} shadow(s) dropped`);
    if (this.textBoxesPreScaled) parts.push(`${this.textBoxesPreScaled} text box(es) pre-scaled`);
    if (this.unknownShapes) parts.push(`${this.unknownShapes} unknown shape(s) → rect`);
    if (this.unknownLayoutTypes) parts.push(`${this.unknownLayoutTypes} unknown layout type(s)`);
    if (this.skippedImages) parts.push(`${this.skippedImages} image(s) skipped`);
    if (this.transitionsApproximated)
      parts.push(`${this.transitionsApproximated} transition(s) approximated`);
    if (parts.length === 0) return 'Imported with no fallbacks.';
    return `Imported with ${parts.join(', ')}.`;
  }
}
