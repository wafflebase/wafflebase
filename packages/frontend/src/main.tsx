import { createRoot } from "react-dom/client";
import { setCredentialedImageOrigins } from "@wafflebase/core/image";
import "./index.css";
import App from "./App.tsx";
import { StrictMode } from "react";
import { backendOrigin } from "@/api/images";

// Images served by our own API are requested with credentialed CORS, so the
// canvases that draw them stay readable and the template gallery can encode a
// thumbnail of them (docs/design/template-gallery.md). Declared once here
// because the engine packages that load the images have no `import.meta.env`
// of their own; anything not on this origin loads exactly as it always has.
setCredentialedImageOrigins([backendOrigin()]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
