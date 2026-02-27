import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { lazy, Suspense, useState } from "react";
import { Loader } from "@/components/loader";

import { PrivateRoute } from "./PrivateRoute";
import { PublicRoute } from "./PublicRoute";
import { ThemeProvider } from "./components/theme-provider";

const Login = lazy(() => import("@/app/login/page"));
const Documents = lazy(() => import("@/app/documents/page"));
const DocumentDetail = lazy(() => import("@/app/documents/document-detail"));
const DataSourcesPage = lazy(() => import("@/app/datasources/page"));
const SharedDocument = lazy(() => import("@/app/shared/shared-document"));
const Settings = lazy(() => import("@/app/settings/page"));
const VisualHarnessPage = lazy(() => import("@/app/harness/visual/page"));
const InteractionHarnessPage = lazy(() => import("@/app/harness/interaction/page"));
const Layout = lazy(() => import("./app/Layout"));

function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <Router basename={import.meta.env.VITE_FRONTEND_BASENAME}>
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route element={<PublicRoute />}>
                <Route path="/login" element={<Login />} />
              </Route>
              <Route path="/harness/visual" element={<VisualHarnessPage />} />
              <Route path="/harness/interaction" element={<InteractionHarnessPage />} />
              <Route path="/shared/:token" element={<SharedDocument />} />
              <Route element={<PrivateRoute />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Documents />} />
                  <Route path="/datasources" element={<DataSourcesPage />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                <Route path="/:id" element={<DocumentDetail />} />
              </Route>
            </Routes>
          </Suspense>
        </Router>
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
