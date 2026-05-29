import { useEffect, useState } from 'react';
import type { ConnectorElement, Element, Frame } from '@wafflebase/slides';
import {
  type DisplayUnit,
  degToRad,
  formatDisplay,
  getCommonValue,
  radToDeg,
  unitToPx,
} from './units';

export type SectionKind =
  | 'shape'
  | 'image'
  | 'text-element'
  | 'connector'
  | 'group'
  | 'mixed';

export interface SizePositionSectionProps {
  kind: SectionKind;
  elements: readonly Element[];
  unit: DisplayUnit;
  /** Set when kind === 'text-element' to gate the H input. */
  textAutofitMode?: 'none' | 'shrink' | 'grow';
  onCommitFrame: (ids: readonly string[], patch: Partial<Frame>) => void;
  onTranslate: (ids: readonly string[], dx: number, dy: number) => void;
  onSetUnit: (unit: DisplayUnit) => void;
  /** direction: +1 = clockwise, -1 = counter-clockwise. */
  onRotate90: (ids: readonly string[], direction: 1 | -1) => void;
  /**
   * Called instead of onCommitFrame when the user changes W or H with
   * the lock toggled on. Implementer can write per-element proportional
   * frames in one batch.
   */
  onLockedResize: (
    elements: readonly Element[],
    axis: 'w' | 'h',
    newPx: number,
  ) => void;
}

function anyEndpointAttached(els: readonly Element[]): boolean {
  return els.some(
    (el) =>
      el.type === 'connector' &&
      ((el as ConnectorElement).start.kind === 'attached' ||
        (el as ConnectorElement).end.kind === 'attached'),
  );
}

export function SizePositionSection(props: SizePositionSectionProps) {
  const { kind, elements, unit, textAutofitMode } = props;
  const ids = elements.map((el) => el.id);

  const showWH = kind !== 'connector' && kind !== 'mixed';
  const showRotation = kind !== 'connector' && kind !== 'mixed';
  const xyDisabled = kind === 'connector' && anyEndpointAttached(elements);
  const hDisabled = kind === 'text-element' && textAutofitMode === 'grow';

  const [locked, setLocked] = useState(false);
  // Reset lock state when the selection changes.
  useEffect(() => {
    setLocked(false);
  }, [elements]);

  const w = getCommonValue(elements, (el) => el.frame.w);
  const h = getCommonValue(elements, (el) => el.frame.h);
  const x = getCommonValue(elements, (el) => el.frame.x);
  const y = getCommonValue(elements, (el) => el.frame.y);
  const rotation = getCommonValue(elements, (el) => el.frame.rotation);

  return (
    <section aria-labelledby="format-size-position-label" className="p-3">
      <h3
        id="format-size-position-label"
        className="mb-2 text-xs font-semibold"
      >
        Size &amp; Position
      </h3>

      {showWH && (
        <div className="mb-3 space-y-2">
          <UnitInput
            label="Width"
            valuePx={w}
            unit={unit}
            onCommit={(px) =>
              locked
                ? props.onLockedResize(elements, 'w', px)
                : props.onCommitFrame(ids, { w: px })
            }
          />
          <UnitInput
            label="Height"
            valuePx={h}
            unit={unit}
            disabled={hDisabled}
            disabledTooltip={
              hDisabled
                ? "Height is auto-calculated. Switch autofit to 'None' or 'Shrink' to set manually."
                : undefined
            }
            onCommit={(px) =>
              locked
                ? props.onLockedResize(elements, 'h', px)
                : props.onCommitFrame(ids, { h: px })
            }
          />
          <button
            type="button"
            aria-label="Lock aspect ratio"
            aria-pressed={locked}
            onClick={() => setLocked((v) => !v)}
            className={
              'rounded border px-2 py-1 text-xs ' + (locked ? 'bg-muted' : '')
            }
          >
            {locked ? 'Locked' : 'Lock aspect ratio'}
          </button>
        </div>
      )}

      <div className="mb-3 space-y-2">
        <UnitInput
          label="X position"
          valuePx={x}
          unit={unit}
          disabled={xyDisabled}
          disabledTooltip={
            xyDisabled ? 'Detach endpoints to set position.' : undefined
          }
          onCommit={(px) => {
            if (x === undefined) return;
            props.onTranslate(ids, px - x, 0);
          }}
        />
        <UnitInput
          label="Y position"
          valuePx={y}
          unit={unit}
          disabled={xyDisabled}
          disabledTooltip={
            xyDisabled ? 'Detach endpoints to set position.' : undefined
          }
          onCommit={(px) => {
            if (y === undefined) return;
            props.onTranslate(ids, 0, px - y);
          }}
        />
      </div>

      {showRotation && (
        <div className="mb-3 flex items-center gap-2">
          <RotationInput
            valueRad={rotation}
            onCommit={(rad) => props.onCommitFrame(ids, { rotation: rad })}
          />
          <button
            type="button"
            aria-label="Rotate 90 counter-clockwise"
            onClick={() => props.onRotate90(ids, -1)}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            {'↺'}
          </button>
          <button
            type="button"
            aria-label="Rotate 90 clockwise"
            onClick={() => props.onRotate90(ids, 1)}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            {'↻'}
          </button>
        </div>
      )}

      <fieldset className="mt-2 text-xs">
        <legend className="mb-1">Units</legend>
        <label className="mr-3 inline-flex items-center gap-1">
          <input
            type="radio"
            name="format-unit"
            aria-label="Inches"
            checked={unit === 'in'}
            onChange={() => props.onSetUnit('in')}
          />
          Inches
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="format-unit"
            aria-label="Centimeters"
            checked={unit === 'cm'}
            onChange={() => props.onSetUnit('cm')}
          />
          Centimeters
        </label>
      </fieldset>
    </section>
  );
}

interface UnitInputProps {
  label: string;
  valuePx: number | undefined;
  unit: DisplayUnit;
  disabled?: boolean;
  disabledTooltip?: string;
  onCommit: (px: number) => void;
}

function UnitInput({
  label,
  valuePx,
  unit,
  disabled,
  disabledTooltip,
  onCommit,
}: UnitInputProps) {
  const display = valuePx === undefined ? '' : formatDisplay(valuePx, unit);
  const [draft, setDraft] = useState<string>(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0">{label}</span>
      <input
        aria-label={label}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        value={draft}
        placeholder={valuePx === undefined ? '—' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(display);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (draft === '') return; // blank → no-op
          const n = parseFloat(draft);
          if (!Number.isFinite(n)) {
            setDraft(display);
            return;
          }
          onCommit(unitToPx(n, unit));
        }}
        className="w-24 rounded border px-2 py-1 text-right"
      />
      <span className="w-6 text-muted-foreground">{unit}</span>
    </label>
  );
}

interface RotationInputProps {
  valueRad: number | undefined;
  onCommit: (rad: number) => void;
}

function RotationInput({ valueRad, onCommit }: RotationInputProps) {
  const display = valueRad === undefined ? '' : radToDeg(valueRad).toFixed(2);
  const [draft, setDraft] = useState<string>(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0">Rotation</span>
      <input
        aria-label="Rotation"
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={valueRad === undefined ? '—' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(display);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (draft === '') return;
          const n = parseFloat(draft);
          if (!Number.isFinite(n)) {
            setDraft(display);
            return;
          }
          onCommit(degToRad(n));
        }}
        className="w-24 rounded border px-2 py-1 text-right"
      />
      <span className="w-6 text-muted-foreground">{'°'}</span>
    </label>
  );
}
