import type { Argument, Command, Option } from 'commander';
import {
  getCommandSchema,
  type SafetyLevel,
} from '../schema/registry.js';

/**
 * The command table the Claude Code plugin's permission guard
 * (`plugins/wafflebase/hooks/guard.mjs`) classifies Bash commands with.
 *
 * Built from the real commander tree rather than from the schema registry
 * alone, because the guard sees what a user typed: `doc list`, `tab list`
 * and `docs list` are one command, and only the tree knows every alias.
 * Each leaf is joined to its registry entry for the safety level, so the
 * registry stays the one place a command's safety is decided.
 */
export interface SafetyNode {
  /** Alternate names commander accepts for this command. */
  aliases?: string[];
  /** Options on this command that always consume the next token. */
  valueOptions?: string[];
  /** Options whose value is optional: they consume the next token unless it is a flag. */
  optionalValueOptions?: string[];
  /** Present on leaves (and on any group that runs an action itself). */
  safety?: SafetyLevel;
  /** The schema's one-line description, quoted in the guard's prompt. */
  description?: string;
  /** A flag whose presence raises the leaf to another safety level. */
  flagSafety?: Record<string, SafetyLevel>;
  /**
   * Variants decided by the payload (`a value is null`), which the guard
   * cannot see on the command line. It must assume they apply.
   */
  conditional?: Array<{ when: string; safety: SafetyLevel }>;
  /**
   * Index of the positional argument naming a local output path (`<file>`,
   * `[out]`). A `read-only` command still writes this machine's disk
   * through it, so the guard does not auto-allow it unless the value is `-`.
   */
  localOutputArg?: number;
  /** Options whose value is a local output path (`--out <file>`). */
  localOutputOptions?: string[];
  children?: Record<string, SafetyNode>;
}

export interface SafetyTable {
  /** CLI version the table was generated from. */
  cliVersion: string;
  root: SafetyNode;
}

/** Thrown when a commander leaf has no schema entry to classify it with. */
export class UnclassifiedCommandError extends Error {
  constructor(readonly path: string) {
    super(`No schema entry classifies \`wafflebase ${path}\``);
  }
}

/**
 * Placeholder names that mean "write the result to this path", whether on a
 * positional argument (`export <doc-id> <file>`) or an option value
 * (`--out <file>`).
 */
const LOCAL_OUTPUT_ARGS = new Set(['file', 'out']);
const OPTION_VALUE_NAME = /[<[]([a-z-]+)[>\]]\s*$/;

function optionNames(opt: Option): string[] {
  return [opt.long, opt.short].filter((n): n is string => Boolean(n));
}

/**
 * `variants[].when` is prose in the registry. "<flag> given" is something
 * the guard can check on the command line; anything else ("a value is
 * null") depends on the payload, so it is carried as a condition the guard
 * has to assume holds.
 */
function variantsOf(
  name: string,
): Pick<SafetyNode, 'flagSafety' | 'conditional'> {
  const out: Pick<SafetyNode, 'flagSafety' | 'conditional'> = {};
  for (const v of getCommandSchema(name)?.variants ?? []) {
    if (v.when === 'default') continue;
    const m = /^(--[a-z][a-z0-9-]*) given$/.exec(v.when);
    if (m) {
      (out.flagSafety ??= {})[m[1]] = v.safety;
    } else {
      (out.conditional ??= []).push({ when: v.when, safety: v.safety });
    }
  }
  return out;
}

function buildNode(cmd: Command, path: string[]): SafetyNode {
  const node: SafetyNode = {};
  const aliases = cmd.aliases();
  if (aliases.length > 0) node.aliases = [...aliases].sort();

  const required = cmd.options.filter((o) => o.required).flatMap(optionNames);
  const optional = cmd.options.filter((o) => o.optional).flatMap(optionNames);
  if (required.length > 0) node.valueOptions = required.sort();
  if (optional.length > 0) node.optionalValueOptions = optional.sort();

  const subs = [...cmd.commands].sort((a, b) =>
    a.name().localeCompare(b.name()),
  );
  if (subs.length > 0) {
    node.children = {};
    for (const sub of subs) {
      node.children[sub.name()] = buildNode(sub, [...path, sub.name()]);
    }
  }

  // A group with no schema entry of its own is fine (`sheets`); a leaf
  // without one is not — the guard would meet it unclassified.
  const schema =
    path.length > 0 ? getCommandSchema(path.join('.')) : undefined;
  if (schema) {
    node.safety = schema.safety;
    node.description = schema.description;
    Object.assign(node, variantsOf(schema.name));
    // Only a read-only command needs this: a write already asks, and on
    // `import <file>` the same name is an input.
    if (schema.safety === 'read-only') {
      const args: readonly Argument[] = cmd.registeredArguments;
      const out = args.findIndex((a) => LOCAL_OUTPUT_ARGS.has(a.name()));
      if (out >= 0) node.localOutputArg = out;
      const outOpts = cmd.options
        .filter((o) => {
          const m = OPTION_VALUE_NAME.exec(o.flags);
          return m !== null && LOCAL_OUTPUT_ARGS.has(m[1]);
        })
        .flatMap(optionNames)
        .sort();
      if (outOpts.length > 0) node.localOutputOptions = outOpts;
    }
  } else if (subs.length === 0 && path.length > 0) {
    throw new UnclassifiedCommandError(path.join(' '));
  }
  return node;
}

export function buildSafetyTable(
  program: Command,
  cliVersion: string,
): SafetyTable {
  return { cliVersion, root: buildNode(program, []) };
}
