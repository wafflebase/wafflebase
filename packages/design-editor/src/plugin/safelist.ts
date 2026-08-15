/**
 * Tailwind candidate registration — the second of §6's two behaviour changes.
 *
 * The editor composes class names at RUNTIME (`gap-3` chosen in a dropdown), so
 * Tailwind has never seen them in any source file and generates no rule for them.
 * The preview then shows the class applied and nothing changing.
 *
 * The prototype solved this by appending `@source inline(...)` to a generated CSS
 * file that its own `sandbox.css` imported. In a consumer's project the candidates
 * must reach the **host's** Tailwind graph instead, so the plugin appends the
 * directive to the host's own entry stylesheet through a `transform` hook — and
 * no-ops entirely when the host is not Tailwind v4, because `@source` is a v4
 * directive and emitting it into a v3 (or plain CSS) pipeline would be a syntax
 * error in someone else's stylesheet.
 */

/**
 * A conservative shape for a utility class.
 *
 * This string is written into the consumer's CSS pipeline, so the alphabet is an
 * allowlist rather than an escape: no quotes, no parens, no whitespace, nothing
 * that could close the `inline(...)` and start something else. Tailwind's own
 * arbitrary-value syntax (`[&>svg]:size-4`, `w-[13px]`) has to survive, which is
 * why `[`, `]`, `&`, `>` and `%` are admitted.
 */
const CANDIDATE_RE = /^[a-z0-9][a-zA-Z0-9:_\-/.[\]&>%]*$/;

/**
 * Upper bound on retained candidates.
 *
 * Unbounded growth would be a slow leak in a long dev session AND a growing
 * recompile cost on every registration, since Tailwind re-scans the directive each
 * time. Dropping the excess is safe: the class simply renders unstyled, the same
 * state it was in before it was registered.
 */
const CANDIDATE_CAP = 4000;

export interface Safelist {
  /** Returns what was taken and what was refused, for the client to surface. */
  register(tokens: string[]): { added: string[]; rejected: string[]; capped: boolean };
  /** The `@source inline(...)` directive, or '' when nothing is registered. */
  directive(): string;
  size(): number;
}

export function createSafelist(): Safelist {
  const candidates = new Set<string>();

  return {
    register(tokens) {
      const added: string[] = [];
      const rejected: string[] = [];
      let capped = false;
      for (const t of tokens) {
        if (typeof t !== 'string' || !CANDIDATE_RE.test(t)) {
          rejected.push(String(t));
          continue;
        }
        if (candidates.has(t)) continue;
        if (candidates.size >= CANDIDATE_CAP) {
          capped = true;
          break;
        }
        candidates.add(t);
        added.push(t);
      }
      return { added, rejected, capped };
    },

    // One directive listing every candidate, rather than one per class: Tailwind
    // parses the file on every change, and thousands of directives is thousands of
    // parse entries for the same result.
    directive: () =>
      candidates.size ? `@source inline(${JSON.stringify([...candidates].sort().join(' '))});\n` : '',

    size: () => candidates.size,
  };
}

/**
 * Is this stylesheet a Tailwind v4 entry?
 *
 * The v4 marker is `@import "tailwindcss"`, which replaced v3's
 * `@tailwind base/components/utilities`. Testing for it is what makes the no-op
 * automatic: a v3 project, a CSS-modules project, or a plain stylesheet simply
 * never matches, so the plugin never writes a directive their pipeline cannot
 * parse. A v3 project therefore loses runtime-composed classes and keeps a working
 * build, which is the right way round.
 */
export const isTailwindV4Entry = (css: string): boolean =>
  /@import\s+["']tailwindcss["']/.test(css);
