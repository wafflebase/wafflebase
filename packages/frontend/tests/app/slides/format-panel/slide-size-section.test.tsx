import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlideSizeSection } from '@/app/slides/format-panel/slide-size-section';

describe('SlideSizeSection', () => {
  it('shows the fixed 10" width and the current height in the display unit', () => {
    render(<SlideSizeSection heightPx={1080} unit="in" onCommit={vi.fn()} />);
    // Width is fixed at 1920 px = 10"; height 1080 px = 5.625" → "5.63".
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('10.00');
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('5.63');
  });

  it('commits a hand-typed height (converted to px) on blur', () => {
    const onCommit = vi.fn();
    render(<SlideSizeSection heightPx={1080} unit="in" onCommit={onCommit} />);
    const h = screen.getByLabelText('Height') as HTMLInputElement;
    fireEvent.change(h, { target: { value: '7.5' } }); // 7.5 in × 192 = 1440 px
    fireEvent.blur(h);
    expect(onCommit).toHaveBeenCalledWith(1440);
  });

  it('does not commit when the typed height equals the current height', () => {
    const onCommit = vi.fn();
    render(<SlideSizeSection heightPx={1440} unit="in" onCommit={onCommit} />);
    const h = screen.getByLabelText('Height') as HTMLInputElement;
    fireEvent.change(h, { target: { value: '7.50' } }); // 1440 px = current
    fireEvent.blur(h);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('width is disabled (fixed) — typing into it cannot commit', () => {
    render(<SlideSizeSection heightPx={1080} unit="in" onCommit={vi.fn()} />);
    expect((screen.getByLabelText('Width') as HTMLInputElement).disabled).toBe(true);
  });
});
