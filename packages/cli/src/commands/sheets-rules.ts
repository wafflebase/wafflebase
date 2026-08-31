import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import type { ApiResponse, WorksheetRule } from '../client/http-client.js';

/**
 * Worksheet-level rule collections for a spreadsheet tab: conditional formats
 * and data validations. Both endpoints speak the same `{ rules }` envelope
 * (`ApiV1WorksheetRulesController`), and a PUT **replaces** the whole array —
 * a rule omitted from the payload is deleted — so the two groups are one file
 * parameterized by their resource segment and client methods.
 */
export function registerSheetsRulesCommand(parent: Command) {
  registerRuleGroup(parent, {
    group: 'conditional-formats',
    alias: 'conditional-format',
    resource: 'conditional-formats',
    noun: 'conditional format',
    get: (docId, tab, opts) =>
      getClient(opts).getConditionalFormats(docId, tab),
    set: (docId, tab, rules, opts) =>
      getClient(opts).setConditionalFormats(docId, tab, rules),
  });

  registerRuleGroup(parent, {
    group: 'data-validations',
    alias: 'data-validation',
    resource: 'data-validations',
    noun: 'data validation',
    get: (docId, tab, opts) => getClient(opts).getDataValidations(docId, tab),
    set: (docId, tab, rules, opts) =>
      getClient(opts).setDataValidations(docId, tab, rules),
  });
}

type GlobalOpts = ReturnType<typeof getGlobalOpts>;
type RuleResponse = Promise<ApiResponse<{ rules: WorksheetRule[] }>>;

interface RuleGroupSpec {
  /** Command name, e.g. `conditional-formats`. */
  group: string;
  /** Singular spelling accepted as an alias. */
  alias: string;
  /** Path segment under `/documents/:id/tabs/:tab/`. */
  resource: string;
  /** Human-readable singular noun used in help and error text. */
  noun: string;
  get: (docId: string, tab: string, opts: GlobalOpts) => RuleResponse;
  set: (
    docId: string,
    tab: string,
    rules: WorksheetRule[],
    opts: GlobalOpts,
  ) => RuleResponse;
}

function registerRuleGroup(parent: Command, spec: RuleGroupSpec) {
  const group = parent
    .command(spec.group)
    .alias(spec.alias)
    .description(`Read and write ${spec.noun} rules`);

  group
    .command('get <doc-id>')
    .description(`Get the ${spec.noun} rules of a tab`)
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/${spec.resource}`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await spec.get(docId, tab, opts);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  group
    .command('set <doc-id>')
    .description(
      `Replace the ${spec.noun} rules of a tab (JSON from stdin or --data)`,
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Rule data as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // Parse inside a try: a malformed `--data`/stdin payload is user
      // input, and the message has to name which one it came from.
      // `runCli` would envelope an uncaught `SyntaxError` anyway, but
      // as a bare "Unexpected token …" with no mention of `--data` or
      // stdin, and it has to be caught here to add that.
      let parsed: unknown;
      try {
        let raw: string;
        if (dataStr) {
          raw = dataStr;
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          raw = Buffer.concat(chunks).toString('utf-8');
        }
        parsed = JSON.parse(raw) as unknown;
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON rule data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
          this,
        );
        return;
      }

      // Both the bare array and the `{ rules: [...] }` envelope are accepted,
      // so `… get | … set` round-trips: `get` prints the envelope the server
      // returns, and re-typing it into `set` must not be an error.
      //
      // Checked BEFORE the dry-run branch: the server rejects anything whose
      // `rules` is not an array with a 400, and a dry run that prints a body
      // the server would reject is worse than no dry run at all.
      const rules = extractRules(parsed);
      if (!rules) {
        outputError(
          new Error(
            `Invalid ${spec.noun} data${
              dataStr ? ' in --data' : ' on stdin'
            }: expected an array of rules or an object { "rules": [...] }.`,
          ),
          this,
        );
        return;
      }

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/${spec.resource}`,
            { rules },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await spec.set(docId, tab, rules, opts);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

/**
 * Narrow a parsed payload to the rule array the PUT body wraps, accepting
 * either the bare array or the `{ rules: [...] }` envelope `get` prints.
 * Returns `undefined` for anything else, which the caller reports as a user
 * error rather than sending on to a guaranteed 400.
 */
function extractRules(parsed: unknown): WorksheetRule[] | undefined {
  if (Array.isArray(parsed)) return parsed as WorksheetRule[];
  if (typeof parsed === 'object' && parsed !== null) {
    const { rules } = parsed as { rules?: unknown };
    if (Array.isArray(rules)) return rules as WorksheetRule[];
  }
  return undefined;
}
