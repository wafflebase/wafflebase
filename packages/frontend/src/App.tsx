import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useState } from "react";
import { Loader } from "@/components/loader";

import { PrivateRoute } from "./PrivateRoute";
import { PublicRoute } from "./PublicRoute";
import { ThemeProvider } from "./components/theme-provider";
import { HomeOrRedirect } from "./app/home-or-redirect";
import { AnalyticsTracker } from "./analytics";

const Login = lazy(() => import("@/app/login/page"));
const Documents = lazy(() => import("@/app/documents/page"));
const DocumentDetail = lazy(() => import("@/app/documents/document-detail"));
const DataSourcesPage = lazy(() => import("@/app/datasources/page"));
const SharedDocument = lazy(() => import("@/app/shared/shared-document"));
const TemplateLanding = lazy(() => import("@/app/templates/template-landing"));
const TemplateReviewQueue = lazy(
  () => import("@/app/templates/template-review-queue"),
);
const PublicTemplates = lazy(
  () => import("@/app/templates/public-templates"),
);
const Settings = lazy(() => import("@/app/settings/page"));
const VisualHarnessPage = lazy(() => import("@/app/harness/visual/page"));
const InteractionHarnessPage = lazy(
  () => import("@/app/harness/interaction/page"),
);
const DocsHarnessPage = lazy(() => import("@/app/harness/docs/page"));
/**
 * DEV-only, unlike the three harness routes above, and the reason is measurable.
 *
 * This one mounts the real `DocsFormattingToolbar`, which makes it a SECOND
 * separately-split importer of modules previously reached only through `docs-view`.
 * Vite responds with the usual second-importer hoist, and a production build gained
 * SEVEN chunks (147 -> 154): the route itself plus `docs-view`, `docx-actions`,
 * `use-mobile`, `button`, `IconHash` and `IconPalette` lifted out of the docs route
 * chunk. That changes the download shape of a real user-facing route to serve a page
 * no user can reach.
 *
 * `import.meta.env.DEV` is statically replaced at build time, so the import edge
 * disappears from the production graph entirely and the count returns to 147. The
 * browser lanes are unaffected: they all run against `vite` dev servers created in
 *-process (`verify-interaction-browser.mjs`, `verify-hunt-oracles.mjs`,
 * `hunt-ui-runner.mjs`), where DEV is true.
 */
const HuntHarnessPage = import.meta.env.DEV
  ? lazy(() => import("@/app/harness/hunt/page"))
  : null;
/**
 * The debug-report overlay. DEV-gated for the same chunk-graph reason as above,
 * and because the deployed transport does not exist yet (SP2 in
 * `docs/design/debug-report.md`).
 */
const DebugReportMount = import.meta.env.DEV
  ? lazy(() => import("./debug/mount"))
  : null;
const DocsDetail = lazy(() => import("@/app/docs/docs-detail"));
const SlidesDetail = lazy(() => import("@/app/slides/slides-detail"));
const FileDetail = lazy(() => import("@/app/files/file-detail"));
const NotesDetail = lazy(() => import("@/app/notes/notes-detail"));
const BoardDetail = lazy(() => import("@/app/board/board-detail"));
const DocumentAnalyticsPage = lazy(
  () => import("@/app/analytics/document-analytics"),
);
const Layout = lazy(() => import("./app/Layout"));

const WorkspaceDocuments = lazy(
  () => import("@/app/workspaces/workspace-documents"),
);
const WorkspaceSettings = lazy(
  () => import("@/app/workspaces/workspace-settings"),
);
const WorkspaceAnalytics = lazy(
  () => import("@/app/workspaces/workspace-analytics"),
);
const WorkspaceTemplates = lazy(
  () => import("@/app/workspaces/workspace-templates"),
);
const WorkspaceDataSources = lazy(
  () => import("@/app/workspaces/workspace-datasources"),
);
const InviteAccept = lazy(() => import("@/app/workspaces/invite-accept"));

function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <TooltipProvider delayDuration={0}>
        <QueryClientProvider client={queryClient}>
          <Router basename={import.meta.env.VITE_FRONTEND_BASENAME}>
            <AnalyticsTracker />
            <Suspense fallback={null}>
              {DebugReportMount && <DebugReportMount />}
            </Suspense>
            <Suspense fallback={<Loader />}>
              <Routes>
                <Route element={<PublicRoute />}>
                  <Route path="/login" element={<Login />} />
                </Route>
                <Route path="/harness/visual" element={<VisualHarnessPage />} />
                <Route
                  path="/harness/interaction"
                  element={<InteractionHarnessPage />}
                />
                <Route path="/harness/docs" element={<DocsHarnessPage />} />
                {HuntHarnessPage && (
                  <Route path="/harness/hunt" element={<HuntHarnessPage />} />
                )}
                <Route path="/shared/:token" element={<SharedDocument />} />
                {/* Public on purpose: a template link is handed to people who
                    may not have an account yet (docs/design/template-gallery.md). */}
                <Route path="/t/:id" element={<TemplateLanding />} />
                {/* Public for the same reason: a gallery nobody can browse
                    without an account is not a public gallery. Using a
                    template still needs one. */}
                <Route path="/templates" element={<PublicTemplates />} />
                <Route path="/" element={<HomeOrRedirect />} />
                <Route element={<PrivateRoute />}>
                  <Route element={<Layout />}>
                    <Route
                      path="/w/:workspaceId"
                      element={<WorkspaceDocuments />}
                    />
                    <Route
                      path="/w/:workspaceId/templates"
                      element={<WorkspaceTemplates />}
                    />
                    <Route
                      path="/w/:workspaceId/datasources"
                      element={<WorkspaceDataSources />}
                    />
                    <Route
                      path="/w/:workspaceId/analytics"
                      element={<WorkspaceAnalytics />}
                    />
                    <Route
                      path="/w/:workspaceId/settings"
                      element={<WorkspaceSettings />}
                    />
                    <Route path="/documents" element={<Documents />} />
                    <Route path="/datasources" element={<DataSourcesPage />} />
                    {/* The reviewer allowlist lives in the backend, so this
                        route is behind PrivateRoute and nothing more: a
                        non-reviewer who reaches it gets a 403 from the queue
                        request. Hiding it client-side would be decoration. */}
                    <Route
                      path="/admin/templates"
                      element={<TemplateReviewQueue />}
                    />
                    <Route path="/settings" element={<Settings />} />
                    {/* Nested under the workspace so Layout resolves the
                        current workspace for the sidebar, and inside Layout so
                        it shows the global sidebar + header. */}
                    <Route
                      path="/w/:workspaceId/analytics/:id"
                      element={<DocumentAnalyticsPage />}
                    />
                  </Route>
                  <Route path="/invite/:token" element={<InviteAccept />} />
                  <Route path="/d/:id" element={<DocsDetail />} />
                  <Route path="/p/:id" element={<SlidesDetail />} />
                  <Route path="/s/:id" element={<DocumentDetail />} />
                  <Route path="/f/:id" element={<FileDetail />} />
                  <Route path="/n/:id" element={<NotesDetail />} />
                  <Route path="/b/:id" element={<BoardDetail />} />
                </Route>
              </Routes>
            </Suspense>
          </Router>
        </QueryClientProvider>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
