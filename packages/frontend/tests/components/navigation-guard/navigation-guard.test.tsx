import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';

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
      {/* The app's own redirects — a 404'd document, an expired session —
          are all `replace`. */}
      <Link to="/login" replace>
        redirect
      </Link>
      <Routes>
        <Route path="/s/doc-1" element={<Editor active={active} guard={guard} />} />
        <Route path="/w/acme" element={<div>workspace page</div>} />
        <Route path="/login" element={<div>login page</div>} />
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

  it('resolves the same-page exemption under a basename', () => {
    // `createHref` does not prepend the basename, but `useNavigate` has
    // already joined it into the pathname it pushes, and `useLocation` strips
    // it. Comparing the two raw would make every navigation "leaving" on a
    // deployment that sets VITE_FRONTEND_BASENAME.
    render(
      <MemoryRouter basename="/app" initialEntries={['/app/s/doc-1']}>
        <NavigationGuardProvider>
          <Link to="/s/doc-1?tab=2">same document</Link>
          <Routes>
            <Route
              path="/s/doc-1"
              element={<Editor active guard={blocking} />}
            />
          </Routes>
        </NavigationGuardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('same document'));

    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
  });

  it('is a no-op outside a provider', () => {
    render(<Harness withProvider={false} />);
    leave();

    expect(screen.getByText('workspace page')).toBeInTheDocument();
  });

  it('never refuses a redirect the app performs on its own behalf', () => {
    // `replace` is how an editor sends you back to the workspace when its
    // document 404s, and how `PrivateRoute` sends you to /login. Blocking one
    // would swallow it for good — the effect that issued it does not run
    // again — leaving the user in an editor for a document that is gone.
    render(<Harness />);

    fireEvent.click(screen.getByText('redirect'));

    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('drops a prompt the app has already navigated past', () => {
    // The provider outlives the route the dialog was asking about, so a
    // navigation that gets through while it is open would otherwise leave a
    // stranded dialog whose "Leave" replays a destination from another page.
    render(<Harness />);
    leave();
    expect(screen.getByText(PROMPT.title)).toBeInTheDocument();

    fireEvent.click(screen.getByText('redirect'));

    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
  });

  it('keeps a prompt a child effect raised in the commit that moved the location', () => {
    // React runs a child's effects before its parent's, so dropping the prompt
    // from a `location`-keyed effect here would also fire on the commit where
    // a child effect *raised* it — wiping the dialog before the user ever saw
    // it and dropping that navigation in silence.
    function Redirecting() {
      const navigate = useNavigate();
      useNavigationGuard(true, blocking);
      useEffect(() => {
        navigate('/w/acme');
      }, [navigate]);
      return <div>editor</div>;
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <NavigationGuardProvider>
          <Link to="/s/doc-1">open</Link>
          <Routes>
            <Route path="/s/doc-1" element={<Redirecting />} />
            <Route path="/w/acme" element={<div>workspace page</div>} />
          </Routes>
        </NavigationGuardProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('open'));

    expect(screen.getByText(PROMPT.title)).toBeInTheDocument();
    expect(screen.queryByText('workspace page')).not.toBeInTheDocument();
  });

  it('keeps an open prompt through a query rewrite of the same page', () => {
    // The same-page exemption says a document rewriting its own query string
    // is not leaving anything — so it is not an answer to a dialog the user
    // still has open either.
    render(<Harness />);
    leave();

    fireEvent.click(screen.getByText('same document'));

    expect(screen.getByText(PROMPT.title)).toBeInTheDocument();
  });

  it('stops asking once the component that registered the guard is gone', () => {
    // The provider is mounted at the app root and never unmounts, so a guard
    // that outlived its owner would prompt on every navigation for the rest of
    // the session — with a dead document's answer.
    function Toggling({ mounted }: { mounted: boolean }) {
      return (
        <MemoryRouter initialEntries={['/s/doc-1']}>
          <NavigationGuardProvider>
            <Link to="/w/acme">workspace</Link>
            {mounted && <Editor active guard={blocking} />}
            <Routes>
              <Route path="/w/acme" element={<div>workspace page</div>} />
            </Routes>
          </NavigationGuardProvider>
        </MemoryRouter>
      );
    }

    const { rerender } = render(<Toggling mounted />);
    rerender(<Toggling mounted={false} />);

    leave();

    expect(screen.queryByText(PROMPT.title)).not.toBeInTheDocument();
    expect(screen.getByText('workspace page')).toBeInTheDocument();
  });
});
