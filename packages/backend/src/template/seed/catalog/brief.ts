/**
 * Authoring brief for a template — the values an agent should ask a user for
 * before it writes a deck from that template.
 *
 * This is guidance for an author, not a slot schema: the template itself stays
 * static (its `<team>`-style hints are ordinary text), nothing at use time reads
 * a brief, and there is no substitution pass. See "Briefs are authoring
 * guidance, not slots" in docs/design/template-gallery.md for why that keeps
 * clear of the declined parameterized-templates design.
 */

export type FieldType =
  | 'text' // a short single value (e.g. team name, quarter)
  | 'line' // a one-line sentence (e.g. the one-line pitch)
  | 'list' // several short bullet lines
  | 'pairs' // rows of two values (e.g. action + owner)
  | 'metric'; // a headline number + its caption

export interface FieldSpec {
  /** Stable id used to map the value into the deck. */
  key: string;
  /** What the fill agent shows the user. */
  label: string;
  type: FieldType;
  /** An example value, so the agent (and the user) see the expected shape. */
  example?: string;
  /** For `list` / `pairs`: how many rows the slide is designed for. */
  min?: number;
  max?: number;
  /** For `pairs`: the two column labels. */
  pair?: [string, string];
}

export interface TemplateBrief {
  /** Matches a `TemplateSeed.slug`. */
  slug: string;
  /** One line on what the deck is for — helps the agent frame its questions. */
  summary: string;
  fields: FieldSpec[];
}
