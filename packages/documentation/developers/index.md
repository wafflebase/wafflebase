---
title: Developers
description: Script Wafflebase from the terminal, call it over HTTP, let Claude Code work in your workspace, or run your own server.
type: overview
---

# Developers

Wafflebase gives developers four ways in: a command-line tool, a REST API, a Claude Code plugin, and a server you can host yourself.

Use it to:

- Script your documents: load CSV data into a sheet, export a doc to PDF, or import a PowerPoint deck.
- Connect another service over HTTP with a workspace API key.
- Let Claude Code find, read, and edit documents for you, asking before every change.
- Run Wafflebase on your own infrastructure.

## Get started

1. Install the CLI and sign in: `npm install -g @wafflebase/cli`, then `wafflebase login`. See [Install and sign in](/developers/cli/).
2. List your documents with `wafflebase docs list --format table`, then read one with `wafflebase docs content <doc-id> --format md`. See [Documents and notes](/developers/cli/documents).
3. Automate it: create an API key and run the same commands from a script or CI job. See [Automation and agents](/developers/cli/automation).

## Use the command line

| To do this | See |
|---|---|
| Install the CLI, sign in, and pick a workspace | [Install and sign in](/developers/cli/) |
| Create, copy, move, read, import, and export docs and notes; manage folders, comments, and templates | [Documents and notes](/developers/cli/documents) |
| Read and write cells, import CSV, and format tabs | [Sheets](/developers/cli/sheets) |
| Build and check decks, and add stickies and sections to a board | [Slides and boards](/developers/cli/slides-and-board) |
| Store any file as a document and upload images | [Files and images](/developers/cli/files-and-images) |
| Run the CLI in CI or from an agent, and handle its errors | [Automation and agents](/developers/cli/automation) |

## Work with Claude Code

| To do this | See |
|---|---|
| Install the plugin, find and publish documents, and control what asks for confirmation | [Claude Code plugin](/developers/claude-code-plugin) |
| Create a bot and let your Claude Code session answer when you mention it in chat | [Put a bot to work](/developers/bots) |

## Call the REST API

| To do this | See |
|---|---|
| Learn the base URL, authentication, and errors | [REST API overview](/developers/api/) |
| Make your first calls with an API key | [Quickstart](/developers/api/quickstart) |
| Manage documents and folders | [Documents and folders](/developers/api/documents-and-folders) |
| Read and write sheets | [Sheets](/developers/api/sheets) |
| Read and replace document content | [Document content](/developers/api/content) |
| Add and arrange board elements | [Boards](/developers/api/board) |
| Get a signed request when something changes in a workspace | [Webhooks](/developers/webhooks) |

## Host your own server

| To do this | See |
|---|---|
| See what you run and what you need | [Self-hosting overview](/developers/self-hosting/) |
| Run the full stack on your computer | [Local development](/developers/self-hosting/local-development) |
| Look up environment variables | [Configuration](/developers/self-hosting/configuration) |
| Set up GitHub, GitHub Enterprise, or Google sign-in | [Sign-in providers](/developers/self-hosting/sign-in) |
| Deploy to a real domain | [Deploy to production](/developers/self-hosting/deploy) |
| Turn on analytics, lakehouse tables, error tracking, webhooks, or the public template gallery | [Optional features](/developers/self-hosting/optional-features) |
| Fix a deployment that misbehaves | [Troubleshooting](/developers/self-hosting/troubleshooting) |

## Next steps

- [Install and sign in](/developers/cli/) to start using the CLI.
- [Claude Code plugin](/developers/claude-code-plugin) to work on documents by asking Claude.
- [REST API quickstart](/developers/api/quickstart) to call Wafflebase from your own code.
- [Local development](/developers/self-hosting/local-development) to run Wafflebase on your computer.
