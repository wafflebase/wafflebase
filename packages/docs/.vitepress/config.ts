import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Wafflebase Docs",
  description: "Documentation for Wafflebase — collaborative spreadsheet",
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
      { text: "API Reference", link: "/api/rest-api" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Build a Budget", link: "/guide/build-a-budget" },
          { text: "Collaboration", link: "/guide/collaboration" },
          { text: "Formulas", link: "/guide/formulas" },
          { text: "Keyboard Shortcuts", link: "/guide/keyboard-shortcuts" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "REST API", link: "/api/rest-api" },
          { text: "CLI", link: "/api/cli" },
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
