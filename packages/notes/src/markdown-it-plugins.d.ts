/**
 * `markdown-it-task-lists` ships no published TypeScript types. Declare it as
 * an untyped module so `import taskLists from 'markdown-it-task-lists'` type
 * checks without resorting to `any` casts or `@ts-ignore`.
 *
 * (`@vscode/markdown-it-katex`, `highlight.js`, and `katex` all ship their
 * own types and need no ambient declaration here.)
 */
declare module 'markdown-it-task-lists';
