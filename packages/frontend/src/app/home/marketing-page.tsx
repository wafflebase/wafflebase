import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";
import { NavBar } from "./nav-bar";
import { Footer } from "./footer";

/**
 * The page chrome every **public** route shares with the landing page: the
 * sticky `NavBar`, the `Footer`, and the `--wb-bg` surface between them.
 *
 * It exists because `/templates` and `/t/:id` sit outside `PrivateRoute` on
 * purpose — a template link is handed to people who may not have an account —
 * and a stranger arriving there was previously dropped onto a bare page with
 * no way back to anything. Wrapping them here makes the two public template
 * surfaces read as the same site as `/`.
 *
 * It resolves `workspacePath` itself rather than taking it as a prop, so a
 * caller only has to say what it is, not re-derive who is looking at it. Both
 * probes are optional: the page renders either way, and they only decide which
 * CTA the nav offers.
 */
export function MarketingPage({
  children,
  signInTo,
}: {
  children: React.ReactNode;
  /**
   * Where the signed-out nav CTA goes. Pass a `returnTo` so signing in from
   * here comes back here.
   */
  signInTo?: string;
}) {
  const me = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: !!me.data,
    retry: false,
  });

  // Null for a signed-out visitor *and* for a signed-in one with no workspace
  // yet, which is the same thing the landing page does with them.
  const first = workspaces.data?.[0];
  const workspacePath = first ? `/w/${first.slug}` : null;

  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--wb-bg)]">
      <NavBar workspacePath={workspacePath} signInTo={signInTo} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
