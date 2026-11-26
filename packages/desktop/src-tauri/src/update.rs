//! Updates of the shell itself. The UI is the deployment's frontend and
//! updates with the server, so this only ever replaces the native app.
//!
//! The manifest endpoint and the minisign public key are compiled in
//! (`plugins.updater` in `tauri.conf.json`); the updater refuses a package
//! whose signature does not verify against that key. See
//! `docs/design/desktop-app.md` §5 and §7.
//!
//! Flow: check at launch (release builds) and once a day, or on "Check for
//! Updates…"; download in the background; then ask. "Restart Now" installs
//! and relaunches. "Later" keeps the package and installs it when the app
//! quits, so the next launch runs the new version without asking again.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::dlog;

/// How often a running app looks again after the launch check.
const RECHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
pub struct Updates {
    /// A check or download is running; a second request is dropped.
    busy: AtomicBool,
    /// Downloaded and verified, waiting for a restart or for quit.
    pending: Mutex<Option<(Update, Vec<u8>)>>,
}

impl Updates {
    fn pending(&self) -> std::sync::MutexGuard<'_, Option<(Update, Vec<u8>)>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Launch-time and daily checks. Debug builds skip them: their version is
/// whatever the working tree says, and the menu item still works there.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            check(&app, false).await;
            tokio::time::sleep(RECHECK_INTERVAL).await;
        }
    });
}

/// "Check for Updates…": the same check, but it always answers.
pub fn check_from_menu<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(&app, true).await });
}

/// Installs a package the user deferred with "Later". Called on
/// `RunEvent::Exit`; on Windows the installer takes over and the process
/// exits here, without relaunching the app the user just quit.
pub fn install_pending_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<Updates>() else {
        return;
    };
    let Some((update, bytes)) = state.pending().take() else {
        return;
    };
    dlog!("installing {} on quit", update.version);
    let update = update.restart_after_install(false);
    if let Err(e) = update.install(bytes) {
        eprintln!("[wafflebase-desktop] update install failed: {e}");
    }
}

async fn check<R: Runtime>(app: &AppHandle<R>, manual: bool) {
    let state = app.state::<Updates>();
    if state.pending().is_some() {
        // Already downloaded: ask again rather than fetching it twice.
        if manual {
            prompt_restart(app);
        }
        return;
    }
    if state.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    let result = fetch(app).await;
    state.busy.store(false, Ordering::Release);

    match result {
        Ok(Some(downloaded)) => {
            *state.pending() = Some(downloaded);
            prompt_restart(app);
        }
        Ok(None) => {
            if manual {
                let version = app.package_info().version.to_string();
                app.dialog()
                    .message(format!("Wafflebase {version} is the latest version."))
                    .title("You're up to date")
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
        }
        Err(e) => {
            // A failed background check is not the user's problem; a failed
            // check they asked for is.
            eprintln!("[wafflebase-desktop] update check failed: {e}");
            if manual {
                app.dialog()
                    .message(format!("Could not check for updates.\n\n{e}"))
                    .title("Update check failed")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
        }
    }
}

async fn fetch<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri_plugin_updater::Result<Option<(Update, Vec<u8>)>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    dlog!("update {} available, downloading", update.version);
    // `download` verifies the signature before returning the bytes.
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

fn prompt_restart<R: Runtime>(app: &AppHandle<R>) {
    let Some(version) = app
        .state::<Updates>()
        .pending()
        .as_ref()
        .map(|(u, _)| u.version.clone())
    else {
        return;
    };
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "Wafflebase {version} is ready to install. Restart now, or it \
             will be installed when you quit."
        ))
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart Now".into(),
            "Later".into(),
        ))
        .show(move |restart| {
            if restart {
                restart_into_update(&handle);
            }
        });
}

fn restart_into_update<R: Runtime>(app: &AppHandle<R>) {
    let Some((update, bytes)) = app.state::<Updates>().pending().take() else {
        return;
    };
    // Windows: the installer runs, exits this process and relaunches the app.
    // macOS: the bundle is replaced in place; relaunch to run it.
    match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(e) => {
            eprintln!("[wafflebase-desktop] update install failed: {e}");
            app.dialog()
                .message(format!("The update could not be installed.\n\n{e}"))
                .title("Update failed")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}
