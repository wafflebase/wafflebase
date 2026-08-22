import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Slider } from '@/components/ui/slider';

describe('Slider', () => {
  it('forwards accessible text to the thumb that owns the slider role', () => {
    const view = render(
      <Slider
        aria-label="Lakehouse commit"
        aria-valuetext="Snapshot 10"
        value={[1]}
      />,
    );

    const thumb = screen.getByRole('slider', { name: 'Lakehouse commit' });
    expect(thumb.getAttribute('aria-valuetext')).toBe('Snapshot 10');

    view.rerender(
      <Slider
        aria-label="Lakehouse commit"
        aria-valuetext="Version 3"
        value={[1]}
      />,
    );
    expect(thumb.getAttribute('aria-valuetext')).toBe('Version 3');
  });
});
