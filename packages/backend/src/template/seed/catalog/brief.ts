/**
 * Input schema for a template — the "required values" a fill agent collects
 * from the user before it fills the blank template's placeholders.
 *
 * The seed catalogue ships each template BLANK (with `<placeholder>` slots).
 * A brief declares, per template, exactly what to ask for and where it goes,
 * so filling is "give me these values" rather than "just make something".
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
