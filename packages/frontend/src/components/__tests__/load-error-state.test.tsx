import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '@/api/http-error';
import { LoadErrorState } from '../load-error-state';

describe('LoadErrorState', () => {
  const NO_ACCESS = "You don't have access to this workspace.";

  it.each([403, 404])(
    'shows the no-access message and no retry for a %i',
    (status) => {
      render(
        <LoadErrorState
          title="Couldn't load documents."
          error={new HttpError('nope', status)}
          onRetry={vi.fn()}
          noAccessMessage={NO_ACCESS}
        />,
      );

      expect(screen.getByText(NO_ACCESS)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    },
  );

  it('keeps the retry for a 403 when no no-access message is given', () => {
    render(
      <LoadErrorState
        title="Couldn't load documents."
        error={new HttpError('nope', 403)}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('offers a retry that calls back for any other error', () => {
    const onRetry = vi.fn();
    render(
      <LoadErrorState
        title="Couldn't load documents."
        error={new HttpError('boom', 500)}
        onRetry={onRetry}
        noAccessMessage={NO_ACCESS}
      />,
    );

    expect(screen.queryByText(NO_ACCESS)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
