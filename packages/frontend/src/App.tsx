import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Login from "@/app/login/page";
import Documents from "@/app/documents/page";
import DocumentDetail from "@/app/documents/document-detail";
import Settings from "@/app/settings/page";
import { PrivateRoute } from "./PrivateRoute";
import { PublicRoute } from "./PublicRoute";
import { ThemeProvider } from "./components/theme-provider";
import Layout from "./app/Layout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <QueryClientProvider client={new QueryClient()}>
        <Router basename={import.meta.env.VITE_SYNCUP_BASENAME}>
          <Routes>
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<Login />} />
            </Route>
            <Route element={<PrivateRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Documents />} />
                <Route path="/:id" element={<DocumentDetail />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
          </Routes>
        </Router>
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
