---
title: Use the desktop app
description: Install the Wafflebase desktop app on a Mac or Windows PC, sign in, connect it to your team's server, and keep it up to date.
type: how-to
---

# Use the desktop app

Install the Wafflebase desktop app on a Mac or Windows PC, sign in, connect it to your team's server, and keep it up to date.

The app opens the same Wafflebase you use in a browser, in its own window. Your account, documents, and share links are the same in both.

::: info Before you start
- Available for macOS (Apple silicon and Intel) and Windows (64-bit). A Linux version is not available yet.
- Sign in with GitHub. Google sign-in isn't available in the desktop app yet.
- Documents need a connection to the server. You can't edit offline.
:::

## Install on a Mac

::: tip Download says Not Found?
The download links point at the latest Wafflebase release. If one answers **Not Found**, that release doesn't include the app yet, or was published in the last half hour and is still being built. Try again later, or see the [releases page](https://github.com/wafflebase/wafflebase/releases).
:::

1. Download [Wafflebase_universal.dmg](https://github.com/wafflebase/wafflebase/releases/latest/download/Wafflebase_universal.dmg).
2. Open the downloaded file.
3. Drag **Wafflebase** into the **Applications** folder.
4. Open **Wafflebase** from **Applications** or Launchpad.

The Mac app is signed and notarized by Apple, so it opens without a security warning.

## Install on Windows

1. Download [Wafflebase_x64-setup.exe](https://github.com/wafflebase/wafflebase/releases/latest/download/Wafflebase_x64-setup.exe).
2. Open the downloaded file.
3. If **Windows protected your PC** appears, click **More info**, then click **Run anyway**.
4. Follow the installer, then open **Wafflebase** from the Start menu.

The Windows installer is not code-signed yet, so Windows SmartScreen warns you the first time you run it. Only run an installer you downloaded from the link above.

## Sign in

The first time you open the app, it shows the sign-in page of the official server, [wafflebase.io](https://wafflebase.io). To use your team's own server instead, [connect to it](#connect-to-your-team-s-server) first.

1. Click **Continue with GitHub**.
2. Your web browser opens on **Continue signing in to the Wafflebase desktop app?** Click **Continue**.
3. Approve the request on GitHub's page, if it asks.
4. When the browser tab says **Return to Wafflebase**, switch back to the app.

The app comes to the front and opens your documents. The browser tab is no longer needed, and you stay signed in the next time you open the app.

Signing in happens in your browser so you can use its saved passwords and passkeys. If the app shows a message instead, see [Troubleshooting](/start/troubleshooting#this-server-is-too-old-for-desktop-sign-in).

## Connect to your team's server

If your team runs its own Wafflebase, point the app at it. The app connects to one server at a time.

1. Open the **Change server…** menu item. On a Mac it's in the **Wafflebase** menu. On Windows it's in the **File** menu.
2. Under **Server address**, enter the address you open Wafflebase at in a web browser, for example `https://wafflebase.example.com`.
3. Click **Connect**.

The app opens that server's sign-in page and remembers it the next time you start the app. The address must start with `https://`. Plain `http://` works only for `localhost`.

To go back to the official server, open **Change server…** again and click **Use wafflebase.io**.

## Work in the app

- **Links:** links to other websites, and to this documentation, open in your web browser. Links inside Wafflebase stay in the app.
- **Windows:** a link that opens in a new tab in a browser opens a new app window instead. Each window is titled after the document in it.
- **Back, Forward, and Reload:** the window has no address bar or toolbar. Use the **View** menu to go back, go forward, or reload the page.
- **Downloads:** exported and downloaded files go straight to your **Downloads** folder. A file with the same name gets a number added, such as `budget (1).xlsx`, instead of replacing the old one.

Editor keyboard shortcuts work the same as in a browser. See the shortcuts for [Sheets](/sheets/keyboard-shortcuts), [Docs](/docs-editor/keyboard-shortcuts), [Slides](/slides/keyboard-shortcuts), [Notes](/notes/keyboard-shortcuts), and [Board](/board/keyboard-shortcuts).

## Keep the app up to date

The app checks for a new version when it starts and once a day. It downloads the update in the background and installs it when you quit, so the next launch runs the new version.

On a Mac where your account can't change the app (for example, an admin installed it in **Applications** for everyone), the app can't install updates when you quit. Use **Check for Updates…** and click **Restart Now** instead, and enter an administrator's password when macOS asks.

To check now:

1. Open the **Check for Updates…** menu item, next to **Change server…**.
2. If an update is available, click **Restart Now** to install it, or **Later** to install it when you quit.

If you already have the latest version, the app says **You're up to date**.

The editors and their features come from the server, not from the app. When your server is upgraded, you get the new features without updating the app.

## Use the app offline

When the app can't reach the server, it shows **Can't reach** and the server's address, with the likely cause. It tries again on its own, and opens the server as soon as it answers. Click **Try again** to check now, or **Change server…** to pick another server. If it keeps failing, see [**Can't reach** appears in the desktop app](/start/troubleshooting#can-t-reach-appears-in-the-desktop-app).

After you've used the app online once, it can start with no connection. It then shows **You're offline**. Your documents are stored on the server, so they open again once the connection is back.

If the connection drops while a document is open, the app works like a browser tab. See [Edit together](/collaborate/edit-together) for what the **Saving…**, **Reconnecting…**, and **Not saved** indicators mean.

## Set up your server

For team admins who run their own Wafflebase:

- Run a recent version of Wafflebase. An older server can't sign in from the desktop app, and the app says so.
- Serve sign-in over `https://`, the same rule as CLI sign-in. See [Allow desktop app sign-in](/developers/self-hosting/sign-in#allow-desktop-app-sign-in).
- Tell your team to enter the address the server redirects to after sign-in (`FRONTEND_URL`), not an alias. With an alias, sign-in ends in the browser instead of the app.

## Known limitations

- No Linux version yet.
- Google sign-in isn't available in the app yet. Use GitHub, or use Google in a web browser.
- No offline editing. Documents open only while the app can reach the server.
- The app connects to one server at a time.
- A Wafflebase link you click in another app, such as email or chat, opens in your browser, not in the desktop app.

## Related

- [Getting started](/start/getting-started): build and share your first sheet
- [Use Wafflebase on a phone](/start/phone): what works on a small screen
- [Troubleshooting](/start/troubleshooting): fix sign-in and connection problems in the app
- [Sign-in providers](/developers/self-hosting/sign-in): set up sign-in on your own server
