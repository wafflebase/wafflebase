import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type HeadConfig } from "vitepress";

const docsRoot = path.dirname(fileURLToPath(import.meta.url));
// vitepress build sets NODE_ENV="production" before evaluating this file;
// vitepress dev leaves it unset, so only treat an explicit "production"
// signal as production. Keeps `vitepress dev` out of the GA property.
const mode =
  process.env.NODE_ENV === "production" ? "production" : "development";
const env = loadEnv(mode, path.resolve(docsRoot, ".."), "VITE_");
const gaId = env.VITE_GA_ID;

const head: HeadConfig[] = [
  ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
  [
    "link",
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
  ],
  [
    "link",
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
    },
  ],
];

if (gaId) {
  head.push(
    [
      "script",
      {
        async: "",
        src: `https://www.googletagmanager.com/gtag/js?id=${gaId}`,
      },
    ],
    [
      "script",
      {},
      `window.dataLayer = window.dataLayer || [];\n` +
        `function gtag(){dataLayer.push(arguments);}\n` +
        `gtag('js', new Date());\n` +
        `gtag('config', '${gaId}');`,
    ],
  );
}

export default defineConfig({
  title: "Wafflebase Docs",
  description:
    "Documentation for Wafflebase — collaborative spreadsheet and document editor",
  base: "/docs/",

  head,

  vite: {
    server: {
      open: false,
    },
  },

  themeConfig: {
    siteTitle: "Wafflebase",
    logoLink: { link: "/", target: "_self" },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Sheets", link: "/sheets/build-a-budget" },
      { text: "Docs", link: "/docs-editor/writing-a-document" },
      { text: "Developers", link: "/developers/self-hosting" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          {
            text: "Collaboration & Sharing",
            link: "/guide/collaboration",
          },
        ],
      },
      {
        text: "Sheets",
        items: [
          { text: "Build a Budget", link: "/sheets/build-a-budget" },
          { text: "Formulas", link: "/sheets/formulas" },
          { text: "Charts & Pivot Tables", link: "/sheets/charts" },
          {
            text: "Keyboard Shortcuts",
            link: "/sheets/keyboard-shortcuts",
          },
        ],
      },
      {
        text: "Docs",
        items: [
          {
            text: "Writing a Document",
            link: "/docs-editor/writing-a-document",
          },
          {
            text: "Keyboard Shortcuts",
            link: "/docs-editor/keyboard-shortcuts",
          },
        ],
      },
      {
        text: "Developers",
        items: [
          { text: "Self-Hosting", link: "/developers/self-hosting" },
          { text: "REST API", link: "/developers/rest-api" },
          { text: "CLI", link: "/developers/cli" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/wafflebase/wafflebase" },
    ],

    search: {
      provider: "local",
    },
  },
});
