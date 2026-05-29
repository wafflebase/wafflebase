import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { StrictMode } from "react";
import { buildGoogleFontsHref } from "@/components/text-formatting/font-catalog";

(function injectGoogleFontsLink() {
  if (typeof document === "undefined") return;
  if (document.getElementById("wafflebase-google-fonts")) return;
  const href = buildGoogleFontsHref();
  if (!href) return;
  const link = document.createElement("link");
  link.id = "wafflebase-google-fonts";
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
})();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
