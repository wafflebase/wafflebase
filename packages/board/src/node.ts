// DOM-free public surface for `@wafflebase/board`.
//
// The board's data-model rules — the sticky factory, section membership and
// the agent helpers the `/api/v1` board endpoints are built on — without the
// viewport or the Miro importer. Node consumers (the NestJS backend) reach it
// through the `node` export condition, so an element an agent creates through
// the API comes out of the very factory the canvas uses.
//
// Everything re-exported here must import only from `@wafflebase/slides`'s
// own node entry (`slides/src/node.ts`): the backend maps `@wafflebase/slides`
// to that file at type-check time and Node resolves it to `dist/node.cjs` at
// runtime, so a browser-only symbol fails the backend build or its boot.
export * from './model/sticky';
export * from './model/section';
export * from './agent/summary';
export * from './agent/layout';
export * from './agent/moves';
export * from './agent/membership';
export * from './agent/text';
