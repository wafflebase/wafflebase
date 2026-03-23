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

const Login = lazy(() => import("@/app/login/page"));
const Documents = lazy(() => import("@/app/documents/page"));
const DocumentDetail = lazy(() => import("@/app/documents/document-detail"));
const DataSourcesPage = lazy(() => import("@/app/datasources/page"));
const SharedDocument = lazy(() => import("@/app/shared/shared-document"));
const Settings = lazy(() => import("@/app/settings/page"));
const VisualHarnessPage = lazy(() => import("@/app/harness/visual/page"));
const InteractionHarnessPage = lazy(
  () => import("@/app/harness/interaction/page"),
);
const DocsHarnessPage = lazy(() => import("@/app/harness/docs/page"));
const DocsDetail = lazy(() => import("@/app/docs/docs-detail"));
const Layout = lazy(() => import("./app/Layout"));

const WorkspaceDocuments = lazy(
  () => import("@/app/workspaces/workspace-documents"),
);
const WorkspaceSettings = lazy(
  () => import("@/app/workspaces/workspace-settings"),
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
                <Route path="/shared/:token" element={<SharedDocument />} />
                <Route path="/" element={<HomeOrRedirect />} />
                <Route element={<PrivateRoute />}>
                  <Route element={<Layout />}>
                    <Route
                      path="/w/:workspaceId"
                      element={<WorkspaceDocuments />}
                    />
                    <Route
                      path="/w/:workspaceId/datasources"
                      element={<WorkspaceDataSources />}
                    />
                    <Route
                      path="/w/:workspaceId/settings"
                      element={<WorkspaceSettings />}
                    />
                    <Route path="/documents" element={<Documents />} />
                    <Route path="/datasources" element={<DataSourcesPage />} />
                    <Route path="/settings" element={<Settings />} />
                  </Route>
                  <Route path="/invite/:token" element={<InviteAccept />} />
                  <Route path="/d/:id" element={<DocsDetail />} />
                  <Route path="/:id" element={<DocumentDetail />} />
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
