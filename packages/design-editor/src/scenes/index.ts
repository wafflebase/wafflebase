/**
 * The host ↔ frame layer: the typed message protocol and the drill-in resolver.
 *
 * A subpath of its own, not part of `./client`. Both run in a browser, but they run
 * in DIFFERENT ONES — `./client` is the editor shell talking to the dev server, and
 * this is the contract the shell shares with a scene frame, which is a separate
 * document in a separate JS realm. Collapsing them would put the shell's bridge
 * client into every scene frame's bundle, where it has nothing to do.
 *
 * Nothing here reaches `node:`; `test/client/boundary.test.ts` covers this tree too.
 */

export {
  isFrameMessage,
  isHostMessage,
  parseStampId,
  sceneFrameUrl,
  stampId,
  VIEWPORT_WIDTH,
} from './frame-protocol.ts';
export type {
  FrameMessage,
  FrameRect,
  FrameSide,
  HostMessage,
  StampRef,
  ViewportKey,
} from './frame-protocol.ts';

export { joinPosix, resolveImport } from './import-paths.ts';
export type { AliasEntry } from './import-paths.ts';
