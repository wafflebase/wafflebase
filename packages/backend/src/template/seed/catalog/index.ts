import type { TemplateSeed } from '../types';
import { seeds as boardCore } from './board/core';
import { seeds as boardSections } from './board/sections';
import { seeds as docCore } from './doc/core';
import { seeds as noteCore } from './note/core';
import { seeds as sheetCore } from './sheet/core';
import { seeds as slidesCore } from './slides/core';
import { seeds as slidesEducation } from './slides/education';
import { seeds as slidesMarketFinance } from './slides/market-finance';
import { seeds as slidesMore } from './slides/more';
import { seeds as slidesWork } from './slides/work';

/**
 * Everything `pnpm backend seed:templates` publishes.
 *
 * One import per catalogue file (`<kind>/<family>.ts`, each exporting
 * `seeds`), never one per template: adding a template to an existing file
 * touches nothing here, and adding a file is one import plus one line below.
 * `catalog-files.spec.ts` fails if a file on disk is missing from either.
 *
 * Imports are sorted; the list below is the gallery order and is append-only —
 * a new file goes at the end, so no existing template moves.
 *
 * Licensing: see `README.md` in this directory. Every entry is original to
 * this repository; nothing derived from a third-party template gallery may be
 * added.
 */
export const TEMPLATE_CATALOG: TemplateSeed[] = [
  ...slidesCore,
  ...slidesMore,
  ...slidesEducation,
  ...slidesWork,
  ...slidesMarketFinance,
  ...sheetCore,
  ...docCore,
  ...noteCore,
  ...boardCore,
  ...boardSections,
];
