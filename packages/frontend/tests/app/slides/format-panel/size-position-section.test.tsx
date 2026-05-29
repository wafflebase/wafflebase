import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SizePositionSection } from '@/app/slides/format-panel/size-position-section';
import type { ShapeElement, ConnectorElement, Element } from '@wafflebase/slides';

function shape(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation: number },
): ShapeElement {
  return { id, type: 'shape', frame, data: { kind: 'rect' } };
}

function connector(id: string): ConnectorElement {
  return {
    id,
    type: 'connector',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    routing: 'straight',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 0 },
    arrowheads: {},
  };
}

const defaultCommit = {
  onCommitFrame: vi.fn(),
  onTranslate: vi.fn(),
  onSetUnit: vi.fn(),
  onRotate90: vi.fn(),
  onLockedResize: vi.fn(),
};

describe('SizePositionSection (shape)', () => {
  it('shows W/H/X/Y/Rotation inputs and the in/cm radio', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 192, y: 96, w: 384, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.getByLabelText(/^width$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^height$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^x position$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^y position$/i)).toBeTruthy();
    expect(screen.getByLabelText(/rotation/i)).toBeTruthy();
    expect(screen.getByLabelText(/inches/i)).toBeTruthy();
    expect(screen.getByLabelText(/centimeters/i)).toBeTruthy();
  });

  it('shows the value formatted in the active unit', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 192, y: 96, w: 384, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('2.00');
    expect((screen.getByLabelText(/^x position$/i) as HTMLInputElement).value).toBe('1.00');
  });

  it('commits w-change in canvas px on blur', () => {
    const onCommitFrame = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 192, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onCommitFrame={onCommitFrame}
      />,
    );
    const w = screen.getByLabelText(/^width$/i);
    fireEvent.change(w, { target: { value: '3.00' } });
    fireEvent.blur(w);
    expect(onCommitFrame).toHaveBeenCalledWith(['a'], { w: 576 });
  });

  it('mixed values render an empty input', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[
          shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 }),
          shape('b', { x: 0, y: 0, w: 200, h: 100, rotation: 0 }),
        ]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('');
  });

  it('rotate90 button calls onRotate90 with all ids and direction', () => {
    const onRotate90 = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onRotate90={onRotate90}
      />,
    );
    fireEvent.click(screen.getByLabelText(/rotate 90 clockwise/i));
    expect(onRotate90).toHaveBeenCalledWith(['a'], 1);
  });

  it('unit radio change calls onSetUnit', () => {
    const onSetUnit = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onSetUnit={onSetUnit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/centimeters/i));
    expect(onSetUnit).toHaveBeenCalledWith('cm');
  });
});

describe('SizePositionSection (connector)', () => {
  it('hides W/H and rotation; X/Y enabled when both endpoints free', () => {
    const conn = connector('c1');
    render(
      <SizePositionSection
        kind="connector"
        elements={[conn]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.queryByLabelText(/^width$/i)).toBeNull();
    expect(screen.queryByLabelText(/^height$/i)).toBeNull();
    expect(screen.queryByLabelText(/rotation/i)).toBeNull();
    expect((screen.getByLabelText(/^x position$/i) as HTMLInputElement).disabled).toBe(false);
  });

  it('disables X/Y when a connector has an attached endpoint', () => {
    const attached: ConnectorElement = {
      ...connector('c1'),
      start: { kind: 'attached', elementId: 'e1', siteIndex: 0 },
    };
    render(
      <SizePositionSection
        kind="connector"
        elements={[attached]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^x position$/i) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('SizePositionSection (mixed)', () => {
  it('only X and Y inputs are visible', () => {
    const mixedSel: Element[] = [
      shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 }),
      connector('c1'),
    ];
    render(
      <SizePositionSection
        kind="mixed"
        elements={mixedSel}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.queryByLabelText(/^width$/i)).toBeNull();
    expect(screen.queryByLabelText(/^height$/i)).toBeNull();
    expect(screen.queryByLabelText(/rotation/i)).toBeNull();
    expect(screen.getByLabelText(/^x position$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^y position$/i)).toBeTruthy();
  });
});

describe('SizePositionSection (text-element with autofit=grow)', () => {
  it('disables H input', () => {
    render(
      <SizePositionSection
        kind="text-element"
        textAutofitMode="grow"
        elements={[shape('t', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^height$/i) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('SizePositionSection lock aspect', () => {
  it('locked W edit calls onLockedResize for each selected element', () => {
    const onLockedResize = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[
          shape('a', { x: 0, y: 0, w: 100, h: 50, rotation: 0 }),
          shape('b', { x: 0, y: 0, w: 200, h: 200, rotation: 0 }),
        ]}
        unit="in"
        {...defaultCommit}
        onLockedResize={onLockedResize}
      />,
    );
    fireEvent.click(screen.getByLabelText(/lock aspect ratio/i));
    const w = screen.getByLabelText(/^width$/i);
    fireEvent.change(w, { target: { value: '2.00' } });
    fireEvent.blur(w);
    expect(onLockedResize).toHaveBeenCalled();
    const [els, axis, px] = onLockedResize.mock.calls[0];
    expect(els.length).toBe(2);
    expect(axis).toBe('w');
    expect(px).toBe(384);
  });
});
