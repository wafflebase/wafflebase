/**
 * Everything the editor UI needs to talk to the plugin, and nothing that needs a DOM.
 *
 * Kept separate from the package root because the root is the VITE PLUGIN: importing
 * it reaches `node:fs`. A browser bundle importing `@wafflebase/design-editor/client`
 * gets only this tree, which is why the split exists.
 */

export { createBridgeClient } from './bridge.ts';
export type {
  BridgeClient,
  BridgeClientOptions,
  BridgeResult,
  CandidatesResult,
  CommitResult,
  FetchLike,
  HealthResult,
  MutateResponse,
  PlanResult,
  PreviewTokensResult,
  TokensResult,
  Transaction,
  TransactionSummary,
  TransactionsResult,
  UndoRedoResult,
  ValidateResult,
} from './bridge.ts';

export {
  buildColorClass,
  derivedStateValue,
  forcedStateClasses,
  NO_STATE_LABEL,
  NO_STATE_ROLE,
  OPACITY_STEPS,
  opacityLabel,
  parseColorClasses,
  promotedTokenKey,
  STATE_UTILITIES,
  STATES,
  stateSlots,
} from './states.ts';
export type { ColorClass, StateKey, StateSlot } from './states.ts';

export { joinPropertyLabels, propertyLabel, scaleLabel } from './property-labels.ts';

export {
  appliedClasses,
  applyClassEdits,
  affectedByToken,
  camelToKebab,
  classEditApplies,
  computeColorReplacements,
  computeScaleReplacement,
  cssVarFor,
  defaultVariantState,
  editCount,
  editStateKey,
  emptyEditState,
  familyMetaOf,
  kebabToCamel,
  layoutEditKey,
  normalizeTokenName,
  overrideClassName,
  revertLayoutIntents,
  saveDiff,
  stageTokenAdd,
  themeVarFor,
  toClassIntent,
  toLayoutIntents,
  toMemberAddIntent,
  toPaletteIntent,
  toTokenIntent,
  toTokenRebindIntent,
  tokenOverrideStyle,
  tokenPreviewStyle,
  utilityFor,
} from './edits.ts';
export type {
  EditRef,
  EditState,
  PendingClassEdit,
  PendingLayoutEdit,
  PendingPaletteEdit,
  PendingTokenAdd,
  PendingTokenEdit,
  PendingTokenRebind,
  PlanItem,
  StyleVars,
  TokenKind,
  VariantState,
} from './edits.ts';
