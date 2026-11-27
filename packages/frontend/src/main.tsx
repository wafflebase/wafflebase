import { createRoot } from "react-dom/client";
import { setCredentialedImageOrigins } from "@wafflebase/core/image";
import "./index.css";
import App from "./App.tsx";
import { StrictMode } from "react";
import { ErrorBoundary } from "@sentry/react";
import { backendOrigin } from "@/api/images";
import { initSentry } from "./sentry.ts";
import { AppCrashFallback } from "@/components/app-crash-fallback";
import { loadBrandFontsForPath } from "@/lib/brand-fonts";
import { isDesktopShell, setUpServiceWorker } from "@/lib/service-worker";

// First statement to run in the module, so a throw anywhere below is still
// reported. A no-op unless `VITE_SENTRY_DSN` is set for this build — see
// `sentry.ts` for why that default is not an oversight.
initSentry();

// Images served by our own API are requested with credentialed CORS, so the
// canvases that draw them stay readable and the template gallery can encode a
// thumbnail of them (docs/design/template-gallery.md). Declared once here
// because the engine packages that load the images have no `import.meta.env`
// of their own; anything not on this origin loads exactly as it always has.
setCredentialedImageOrigins([backendOrigin()]);

// Brand faces only for a cold load of a brand route, started before the
// route chunk is fetched; see `brand-fonts.ts`.
loadBrandFontsForPath(window.location.pathname);

// The offline app shell, in the desktop app only for now. After `load`, so
// installing it (which downloads the boot chunks a second time, mostly from
// the HTTP cache) never competes with the first render.
window.addEventListener("load", () => {
  void setUpServiceWorker({
    production: import.meta.env.PROD,
    setting: import.meta.env.VITE_SERVICE_WORKER,
    desktop: isDesktopShell(),
    base: import.meta.env.BASE_URL,
    container: navigator.serviceWorker,
  });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outside `App` rather than inside it, which costs nothing and catches
        more: `ThemeProvider` writes its class onto `document.documentElement`,
        not onto a wrapper, so the fallback is themed correctly from out here
        and a throw in the provider tree itself is still caught. Without a
        boundary anywhere — and there was none — a render throw unmounts the
        whole tree and leaves the user on a blank page. Reporting needs a DSN;
        the fallback renders either way. */}
    <ErrorBoundary fallback={({ error }) => <AppCrashFallback error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
