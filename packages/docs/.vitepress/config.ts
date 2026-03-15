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
      { text: "Developers", link: "/developers/self-hosting" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Build a Budget", link: "/guide/build-a-budget" },
          { text: "Collaboration & Sharing", link: "/guide/collaboration" },
          { text: "Formulas", link: "/guide/formulas" },
          { text: "Charts & Pivot Tables", link: "/guide/charts" },
          { text: "Keyboard Shortcuts", link: "/guide/keyboard-shortcuts" },
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
