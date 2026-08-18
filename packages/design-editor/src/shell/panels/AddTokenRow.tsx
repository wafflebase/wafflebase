import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import {
  cssVarFor,
  familyMetaOf,
  themeVarFor,
  utilityFor,
  normalizeTokenName,
  stageTokenAdd,
  type PendingTokenAdd,
} from '../../client/edits.ts';
import type { TokenFamilyMeta } from '../../tokens/adapter.ts';
import type { TokenFamily } from '../../plugin/protocol.ts';

/** Is a string a `#rgb`/`#rrggbb` hex the native colour input can round-trip? */
const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

/**
 * The per-section "Add" trigger. Lives in an `AccordionSection` header, so the
 * family is implied by *where you clicked* — there is no type to pick.
 */
export function AddTokenButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-sm border transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Plus className="size-3" />
    </button>
  );
}

/**
 * An inline draft row for a NEW token, rendered as the first child of its
 * section.
 *
 * UX DECISION (replaces the single unified "Add token" popover): the add control
 * lives in each category's header. Three reasons, all specific to this editor:
 *
 *   1. The category IS the type. A unified popover had to ask "Color / Radius /
 *      Typo" as its first question — a step that only existed because the button
 *      had no context. Clicking "+" on **Palette** cannot mean anything else.
 *   2. The result appears where it will live. A draft row inside the section
 *      shows the new token among its siblings, so naming and value collisions are
 *      visible while you type instead of after you stage.
 *   3. It scales with the pipeline. Every family the bridge can inject gets an
 *      add affordance for free; a unified popover grows a chip per family and
 *      goes stale the moment one is wired (which is what happened to Radius/Typo).
 *
 * The trade-off is discoverability — one button is easier to find than four — so
 * the sections are always visible and the button sits in a fixed header slot.
 */
export function AddTokenDraft({
  family,
  families,
  existingKeys,
  onStage,
  onCancel,
}: {
  family: TokenFamily;
  /**
   * Family metadata from `GET /tokens`, not a compiled-in table.
   *
   * The prototype read a module-level `FAMILY_META` whose values were wafflebase's own
   * file paths and variable prefixes — §6's last coupling. The adapter reports them now,
   * so a project whose colour tokens live anywhere else works with no change here.
   */
  families: TokenFamilyMeta[];
  /** Existing kebab keys in this family, to reject collisions. */
  existingKeys: Set<string>;
  onStage: (add: PendingTokenAdd) => void;
  onCancel: () => void;
}) {
  const meta = familyMetaOf(families, family);
  const [name, setName] = useState('');
  const [value, setValue] = useState(meta?.defaultValue ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // The draft is created by a click elsewhere (the header "+"), so focus has to
  // be moved here explicitly or the "immediately create an input" promise is
  // only half kept.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // A family the adapter does not carry is a configuration fact, not a field to default
  // away — the alternative is an input that silently stages nothing.
  if (!meta) {
    return (
      <p className="px-2 py-1.5 text-[10px] text-wb-danger">
        The token adapter reports no {family} family, so nothing can be added here.
      </p>
    );
  }

  const kebab = normalizeTokenName(name);
  const collision = !!kebab && existingKeys.has(kebab);
  const isColorFamily = family === 'semantic' || family === 'palette';
  const valid = kebab.length > 0 && !collision && value.trim().length > 0;

  const stage = () => {
    if (!valid) return;
    // `stageTokenAdd` owns the name rule, and it mirrors the server's on purpose — the
    // prototype built the object here and duplicated a weaker check. It can still refuse
    // (an adapter with no such family, a name that is not an identifier), which is why the
    // result is inspected rather than spread.
    const staged = stageTokenAdd(families, family, name, value.trim());
    if ('error' in staged) {
      setError(staged.error);
      return;
    }
    onStage(staged);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      stage();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="rounded-md border border-dashed border-primary/60 bg-primary/5 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-primary">New {meta.label}</span>
        <span className="font-code text-[10px] text-muted-foreground">
          {kebab ? cssVarFor(meta, kebab) : cssVarFor(meta, meta.placeholder)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={onKeyDown}
          placeholder={meta.placeholder}
          aria-label={`New ${meta.label} name`}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 py-1 font-code text-[11px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {isColorFamily && (
          <input
            type="color"
            value={isHex(value) ? value : '#000000'}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`New ${meta.label} colour`}
            className="size-7 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0.5"
          />
        )}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={`New ${meta.label} value`}
          spellCheck={false}
          className="min-w-0 flex-[1.4] rounded-sm border border-input bg-background px-1.5 py-1 font-code text-[11px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <button
          type="button"
          onClick={stage}
          disabled={!valid}
          aria-label="Stage token"
          title="Stage token (Enter)"
          className="shrink-0 rounded-sm bg-primary p-1 text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          title="Cancel (Esc)"
          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <p className={cn('mt-1 text-[10px]', collision || error ? 'text-destructive' : 'text-muted-foreground')}>
        {error
          ? error
          : collision
          ? `${cssVarFor(meta, kebab)} already exists`
          : kebab
            ? `Creates ${cssVarFor(meta, kebab)} + the ${themeVarFor(meta, kebab)} alias → usable as ${utilityFor(meta, kebab)}`
            : 'Writes the source const, the tokens.css emitter and the Tailwind theme alias.'}
      </p>
    </div>
  );
}
