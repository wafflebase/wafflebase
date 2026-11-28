---
title: Put a bot to work
description: Create a workspace bot, connect it to your Claude Code session, and give it work by mentioning it in chat.
type: how-to
---

# Put a bot to work

Create a workspace bot, connect it to your Claude Code session, and give it work by mentioning it in chat.

A bot is a member of your workspace with its own name and a **Bot** badge. When you mention it, your Claude Code session picks up the message, does the work, and answers in the thread as the bot.

::: info Before you start
- The [Claude Code plugin](/developers/claude-code-plugin) is installed, and `/wafflebase:setup` passes.
- The CLI is version 0.7.0 or later. Check with `wafflebase --version`.
:::

## Create a bot

1. In the web app, click **Settings** in the sidebar.
2. Under **Bots**, click **New bot**.
3. Enter a name, such as `deck-bot`. Use 2 to 32 lowercase letters, digits, or hyphens.
4. Under **Who will mention this bot?**, keep **Just me**.
5. Click **Create**. The **Connect** dialog opens with a pairing code.

From a terminal with a browser session, the same steps are:

```bash
wafflebase bots create deck-bot
wafflebase bots pair-code deck-bot
```

## Connect it to Claude Code

1. In Claude Code, run `/wafflebase:listen` with the code from the **Connect** dialog:

   ```
   /wafflebase:listen 4F2K-9QXD
   ```

2. Approve the `wafflebase agent pair` prompt. The bot's row in **Settings → Bots** changes to **Listening**.

A code works once and expires after 10 minutes. If it expires, click **New code** in the **Connect** dialog, or run `wafflebase bots pair-code deck-bot`.

The next time, start listening by name. You don't need a new code on the same computer:

```
/wafflebase:listen deck-bot
```

To connect a server instead of Claude Code, run `wafflebase agent pair <code>` there. Each computer you connect shows as a host under the bot.

A computer keeps one bot per name. Pairing a bot with the same name from another workspace or server fails and keeps the first one. Disconnect the extra host in **Settings → Bots**. To swap the bots, pair again with a new code and `--replace`.

A host holds a task for 10 minutes, and each reply it sends renews that. If a task runs longer with no reply, another host of the same bot can take it. The first host can then no longer reply to it or close it.

## Give it work

1. In a channel, mention the bot in a message, such as `@deck-bot add a summary slide to the launch deck`. Or open a direct message with the bot and write to it.
2. Claude Code picks up the message and reads the thread it came from.
3. Claude works without asking you. When listening starts, Claude Code asks you once to approve it; after that, Wafflebase reads and ordinary edits run on their own. Wafflebase commands that cannot be undone or leave the workspace — deleting, replacing a whole document, reading or writing a file on your computer, changing keys or sharing — are refused, and the bot tells you in the thread to do it yourself. Typing anything in the Claude Code session ends listening.
4. The bot answers in the thread.

Edits to documents run as you, not as the bot, so the document history shows your name. Because the bot acts with your access, it reads only your messages and its own in the thread; replies from other people never reach your Claude Code.

## Know the limits

- **Only you can give it work.** The bot answers only its owner. A mention from anyone else does nothing for now. **Any member** shows as *Available with team bots*.
- **Your session is dedicated to the bot while it listens.** Press Esc to talk to Claude yourself. Run `/wafflebase:listen deck-bot` to resume.
- **One task at a time.** Messages that arrive while Claude works wait their turn.
- **The bot is offline when the session ends.** Its row shows **Offline** with the time it was last seen. Messages you send while it is offline wait until it listens again.
- **A bot doesn't answer other bots.** A message posted by a bot never starts a task.

## Keep its key safe

Pairing stores the bot's key on your computer in `~/.wafflebase/agents/<bot>.json`, readable only by you. The key stays in your Claude Code: it is never shown, and it is not used by any other `wafflebase` command. Your own sign-in stays separate.

To disconnect every computer, delete the bot: in **Settings → Bots**, click **Delete** on its row, or run:

```bash
wafflebase bots delete deck-bot
```

Deleting a bot revokes its keys and removes it from the workspace. Its messages stay, under its name. You can delete a bot you created; a workspace owner can delete any bot.

## Commands

| Command | Does |
|---|---|
| `wafflebase bots list` | List the workspace's bots, owners, and connected hosts |
| `wafflebase bots create <name>` | Create a bot you manage |
| `wafflebase bots pair-code <name-or-id>` | Get a pairing code |
| `wafflebase bots delete <name-or-id>` | Delete a bot and disconnect its hosts |
| `wafflebase agent pair <code> [--host-name <name>] [--replace]` | Connect this computer to a bot |
| `wafflebase agent list` | List bots connected on this computer |
| `wafflebase agent next <bot> [--wait <seconds>]` | Take the bot's next task, waiting up to 240 seconds |
| `wafflebase agent thread <bot> <task-id>` | Read the thread a task came from |
| `wafflebase agent reply <bot> <task-id> (<body> \| --body-file -)` | Answer as the bot; the listen skill sends the text on stdin so the shell never reads it. `--body-file <path>` sends a file's text, and the plugin always asks first |
| `wafflebase agent complete <bot> <task-id> [--failed]` | Close a task |

The `bots` commands need a browser session. The `agent` commands use only the bot's stored key, and ignore `--api-key`, `--server`, `--workspace`, and `WAFFLEBASE_API_KEY`.

## Related

- [Claude Code plugin](/developers/claude-code-plugin) to install the plugin and control what asks for confirmation.
- [Automation and agents](/developers/cli/automation) for output formats and error codes.
- [Install and sign in](/developers/cli/) for the browser session the `bots` commands need.
