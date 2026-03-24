import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Wafflebase Docs",
  description:
    "Documentation for Wafflebase — collaborative spreadsheet and document editor",
  base: "/docs/",

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
