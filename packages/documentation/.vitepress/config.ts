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
  // `head` hrefs are not rewritten with `base`, unlike `themeConfig.logo`.
  ["link", { rel: "icon", type: "image/svg+xml", href: "/docs/logo.svg" }],
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
    "How to use and self-host Wafflebase: spreadsheets, documents, presentations, notes, and boards",
  base: "/docs/",

  // This package's README and STYLE.md are notes for contributors, not site
  // pages. Without this each builds to /docs/<NAME>.html and joins the local
  // search index, reachable from no sidebar entry.
  srcExclude: ["README.md", "STYLE.md"],

  head,

  vite: {
    server: {
      open: false,
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Wafflebase",
    logoLink: { link: "/", target: "_self" },

    nav: [
      {
        text: "Getting started",
        link: "/start/getting-started"
      },
      {
        text: "Sheets",
        link: "/sheets/"
      },
      {
        text: "Docs",
        link: "/docs-editor/"
      },
      {
        text: "Slides",
        link: "/slides/"
      },
      {
        text: "Notes",
        link: "/notes/"
      },
      {
        text: "Board",
        link: "/board/"
      },
      {
        text: "Developers",
        link: "/developers/"
      }
    ],

    // Developers get their own sidebar so the user-facing tree stays short.
    sidebar: {
      "/developers/": [
        {
          text: "Developers",
          items: [
            {
              text: "Overview",
              link: "/developers/"
            },
            {
              text: "Claude Code plugin",
              link: "/developers/claude-code-plugin"
            },
            {
              text: "Webhooks",
              link: "/developers/webhooks"
            }
          ]
        },
        {
          text: "CLI",
          items: [
            {
              text: "Install and sign in",
              link: "/developers/cli/"
            },
            {
              text: "Documents and notes",
              link: "/developers/cli/documents"
            },
            {
              text: "Sheets",
              link: "/developers/cli/sheets"
            },
            {
              text: "Slides and boards",
              link: "/developers/cli/slides-and-board"
            },
            {
              text: "Files and images",
              link: "/developers/cli/files-and-images"
            },
            {
              text: "Automation and agents",
              link: "/developers/cli/automation"
            }
          ]
        },
        {
          text: "REST API",
          items: [
            {
              text: "Overview",
              link: "/developers/api/"
            },
            {
              text: "Make your first API call",
              link: "/developers/api/quickstart"
            },
            {
              text: "Documents and folders",
              link: "/developers/api/documents-and-folders"
            },
            {
              text: "Sheets",
              link: "/developers/api/sheets"
            },
            {
              text: "Document content",
              link: "/developers/api/content"
            },
            {
              text: "Boards",
              link: "/developers/api/board"
            }
          ]
        },
        {
          text: "Self-hosting",
          items: [
            {
              text: "Overview",
              link: "/developers/self-hosting/"
            },
            {
              text: "Local development",
              link: "/developers/self-hosting/local-development"
            },
            {
              text: "Configuration",
              link: "/developers/self-hosting/configuration"
            },
            {
              text: "Sign-in providers",
              link: "/developers/self-hosting/sign-in"
            },
            {
              text: "Deploy to production",
              link: "/developers/self-hosting/deploy"
            },
            {
              text: "Optional features",
              link: "/developers/self-hosting/optional-features"
            },
            {
              text: "Troubleshooting",
              link: "/developers/self-hosting/troubleshooting"
            }
          ]
        }
      ],
      "/": [
        {
          text: "Get started",
          items: [
            {
              text: "Getting started",
              link: "/start/getting-started"
            },
            {
              text: "Concepts",
              link: "/start/concepts"
            },
            {
              text: "Use Wafflebase on a phone",
              link: "/start/phone"
            },
            {
              text: "Troubleshooting",
              link: "/start/troubleshooting"
            }
          ]
        },
        {
          text: "Collaborate & organize",
          collapsed: true,
          items: [
            {
              text: "Manage workspaces and members",
              link: "/collaborate/workspaces"
            },
            {
              text: "Share a document",
              link: "/collaborate/share"
            },
            {
              text: "Edit together",
              link: "/collaborate/edit-together"
            },
            {
              text: "Comment and mention people",
              link: "/collaborate/comments"
            },
            {
              text: "Use version history",
              link: "/collaborate/version-history"
            },
            {
              text: "Use and publish templates",
              link: "/collaborate/templates"
            },
            {
              text: "Organize documents in folders",
              link: "/collaborate/folders"
            },
            {
              text: "Delete and restore documents",
              link: "/collaborate/trash"
            }
          ]
        },
        {
          text: "Sheets",
          collapsed: true,
          items: [
            {
              text: "Overview",
              link: "/sheets/"
            },
            {
              text: "Build a budget",
              link: "/sheets/build-a-budget"
            },
            {
              text: "Edit and format cells",
              link: "/sheets/edit-and-format"
            },
            {
              text: "Work with rows, columns, and tabs",
              link: "/sheets/rows-columns-tabs"
            },
            {
              text: "Sort and filter",
              link: "/sheets/sort-and-filter"
            },
            {
              text: "Write formulas",
              link: "/sheets/formulas"
            },
            {
              text: "Function reference",
              link: "/sheets/functions"
            },
            {
              text: "Add a chart",
              link: "/sheets/charts"
            },
            {
              text: "Summarize data with a pivot table",
              link: "/sheets/pivot-tables"
            },
            {
              text: "Add checkboxes, dropdowns, and validation",
              link: "/sheets/data-validation"
            },
            {
              text: "Highlight cells with conditional formatting",
              link: "/sheets/conditional-formatting"
            },
            {
              text: "Connect a database",
              link: "/sheets/connect-a-database"
            },
            {
              text: "Read lakehouse tables",
              link: "/sheets/lakehouse"
            },
            {
              text: "Keyboard shortcuts",
              link: "/sheets/keyboard-shortcuts"
            }
          ]
        },
        {
          text: "Docs",
          collapsed: true,
          items: [
            {
              text: "Overview",
              link: "/docs-editor/"
            },
            {
              text: "Write a project proposal",
              link: "/docs-editor/write-a-proposal"
            },
            {
              text: "Format text",
              link: "/docs-editor/format-text"
            },
            {
              text: "Use lists and indents",
              link: "/docs-editor/lists-and-indents"
            },
            {
              text: "Insert and edit tables",
              link: "/docs-editor/tables"
            },
            {
              text: "Add and edit images",
              link: "/docs-editor/images"
            },
            {
              text: "Set up pages, headers, and footers",
              link: "/docs-editor/page-layout"
            },
            {
              text: "Find text and check spelling",
              link: "/docs-editor/find-and-spelling"
            },
            {
              text: "Paste from other apps",
              link: "/docs-editor/paste-from-other-apps"
            },
            {
              text: "Keyboard shortcuts",
              link: "/docs-editor/keyboard-shortcuts"
            }
          ]
        },
        {
          text: "Slides",
          collapsed: true,
          items: [
            {
              text: "Overview",
              link: "/slides/"
            },
            {
              text: "Build a deck",
              link: "/slides/build-a-deck"
            },
            {
              text: "Add content",
              link: "/slides/add-content"
            },
            {
              text: "Style and arrange objects",
              link: "/slides/style-and-arrange"
            },
            {
              text: "Change themes and layouts",
              link: "/slides/themes-and-layouts"
            },
            {
              text: "Add animations and transitions",
              link: "/slides/animations"
            },
            {
              text: "Present a deck",
              link: "/slides/present"
            },
            {
              text: "Keyboard shortcuts",
              link: "/slides/keyboard-shortcuts"
            }
          ]
        },
        {
          text: "Notes",
          collapsed: true,
          items: [
            {
              text: "Overview",
              link: "/notes/"
            },
            {
              text: "Write and format a note",
              link: "/notes/write-and-format"
            },
            {
              text: "Markdown reference",
              link: "/notes/markdown-reference"
            },
            {
              text: "Keyboard shortcuts",
              link: "/notes/keyboard-shortcuts"
            }
          ]
        },
        {
          text: "Board",
          collapsed: true,
          items: [
            {
              text: "Overview",
              link: "/board/"
            },
            {
              text: "Run a retro on a board",
              link: "/board/run-a-retro"
            },
            {
              text: "Add stickies, shapes, and connectors",
              link: "/board/stickies-shapes-connectors"
            },
            {
              text: "Draw on a board",
              link: "/board/draw"
            },
            {
              text: "Group ideas with sections",
              link: "/board/sections"
            },
            {
              text: "Facilitate a session",
              link: "/board/facilitate-a-session"
            },
            {
              text: "Export and import a board",
              link: "/board/export-and-import"
            },
            {
              text: "Keyboard shortcuts",
              link: "/board/keyboard-shortcuts"
            }
          ]
        },
        {
          text: "Files",
          collapsed: true,
          items: [
            {
              text: "Upload files",
              link: "/files/upload"
            },
            {
              text: "Read and comment on PDFs",
              link: "/files/pdfs"
            },
            {
              text: "View images",
              link: "/files/images"
            },
            {
              text: "Import and export files",
              link: "/files/import-export"
            }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/wafflebase/wafflebase" },
    ],

    search: {
      provider: "local",
    },
  },
});
