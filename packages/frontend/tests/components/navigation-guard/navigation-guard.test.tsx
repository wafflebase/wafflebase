import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import { NavigationGuardProvider } from '@/components/navigation-guard/navigation-guard-provider';
import {
  useNavigationGuard,
  type NavigationGuard,
} from '@/components/navigation-guard/use-navigation-guard';

const PROMPT = {
  title: 'Leave without saving?',
  description: 'Your recent changes have not reached the server.',
  confirmLabel: 'Leave',
};

/** A guard that always holds the navigation back. */
const blocking: NavigationGuard = () => PROMPT;
/** A guard that is registered but decides, at fire time, not to block. */
const passing: NavigationGuard = () => null;

function Editor({
  active,
  guard,
}: {
  active: boolean;
  guard: NavigationGuard;
}) {
  useNavigationGuard(active, guard);
  return <div>editor</div>;
}

/**
 * The shape the app has: links that leave, a link that only rewrites the
 * current document's query string, and a guard registered deep inside the
 * route being left.
 */
function Harness({
  active = true,
  guard = blocking,
  withProvider = true,
}: {
  active?: boolean;
  guard?: NavigationGuard;
  withProvider?: boolean;
}) {
  const body = (
    <>
      <Link to="/w/acme">workspace</Link>
      <Link to="/s/doc-1?tab=2">same document</Link>
      <Routes>
        <Route path="/s/doc-1" element={<Editor active={active} guard={guard} />} />
        <Route path="/w/acme" element={<div>workspace page</div>} />
      </Routes>
    </>
  );
  return (
    <MemoryRouter initialEntries={['/s/doc-1']}>
      {withProvider ? (
        <NavigationGuardProvider>{body}</NavigationGuardProvider>
      ) : (
        body
      )}
    </MemoryRouter>
  );
}

const leave = () => fireEvent.click(screen.getByText('workspace'));

describe('NavigationGuardProvider', () => {
  it('holds a navigation back and keeps the user where they were', () => {
    render(<Harness />);
    leave();

    expect(screen.getByText(PROMPT.title)).toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.queryByText('workspace page')).not.toBeInTheDocument();
  });

  it('stays on the page when the user declines', () => {
    render(<Harness />);
    leave();
    fireEvent.click(screen.getByText('Stay'));

    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
  });

  it('replays the exact navigation the user attempted when they confirm', () => {
    render(<Harness />);
    leave();
    fireEvent.click(screen.getByText(PROMPT.confirmLabel));

    expect(screen.getByText('workspace page')).toBeInTheDocument();
    expect(screen.queryByText('editor')).not.toBeInTheDocument();
  });

  it('lets the navigation through when the guard declines at fire time', () => {
    render(<Harness guard={passing} />);
    leave();

    expect(screen.getByText('workspace page')).toBeInTheDocument();
  });

  it('lets the navigation through when no guard is active', () => {
    const guard = vi.fn(blocking);
    render(<Harness active={false} guard={guard} />);
    leave();

    expect(screen.getByText('workspace page')).toBeInTheDocument();
    expect(guard).not.toHaveBeenCalled();
  });

  it('does not treat a query change on the same page as leaving it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('same document'));

    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
  });

  it('is a no-op outside a provider', () => {
    render(<Harness withProvider={false} />);
    leave();

    expect(screen.getByText('workspace page')).toBeInTheDocument();
  });
});
