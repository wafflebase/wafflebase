/// <reference types="vite/client" />

/** Root package.json version, injected via vite.config.ts `define`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Feature flag for version history (docs/design/sheets/... revision
   * history). Ships dark: must be exactly the string "true" — any other
   * value, including "1", is off. See `isHistoryEnabled`.
   */
  readonly VITE_WB_REVISION_HISTORY?: string;
}
