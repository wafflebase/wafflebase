//! Updates of the shell itself. The UI is the deployment's frontend and
//! updates with the server, so this only ever replaces the native app.
//!
//! The manifest endpoint and the minisign public key are compiled in
//! (`plugins.updater` in `tauri.conf.json`); the updater refuses a package
//! whose signature does not verify against that key. See
//! `docs/design/desktop-app.md` §5 and §7.
//!
//! The app is versioned with the server and released with it, which is often,
//! and most of those releases do not touch the shell. So the background check
//! (at launch in release builds, then daily) is silent: it downloads and
//! verifies the package and installs it when the app quits, and the next
//! launch runs it. Only "Check for Updates…" talks to the user: "Restart
//! Now" installs and relaunches, "Later" leaves it for quit.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::dlog;

/// How often a running app looks again after the launch check.
const RECHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// For the whole check: the manifest and the package. Without it a stalled
/// connection would hold `busy` for the rest of the session: the daily check
/// would skip forever and the menu item would never answer. The plugin's own
/// builder timeout does not reach the package download (the `Update` it
/// returns carries none), so this wraps both.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct Updates(Mutex<State>);

/// One lock for all of it, so "is a check running" and "does someone want
/// its answer" cannot be read apart.
#[derive(Default)]
struct State {
    /// A check or download is running.
    busy: bool,
    /// The user asked while it was running; it answers them when done.
    answer: bool,
    /// Downloaded and verified, waiting for a restart or for quit.
    pending: Option<(Update, Vec<u8>)>,
}

impl Updates {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// What a check request does with the state it finds.
#[derive(Debug, PartialEq)]
enum Begin {
    /// Fetch the manifest (and the package, if newer).
    Fetch,
    /// A package is already waiting: offer it instead of fetching again.
    /// A newer release is picked up after the launch that installs it.
    Offer,
    /// A check is running; its result answers this request.
    Join,
    /// Nothing to do: a background request with a check running or a
    /// package already waiting.
    Skip,
}

fn begin(pending: bool, busy: bool, manual: bool) -> Begin {
    match (pending, busy, manual) {
        (true, _, true) => Begin::Offer,
        (false, true, true) => Begin::Join,
        (true, _, false) | (false, true, false) => Begin::Skip,
        (false, false, _) => Begin::Fetch,
    }
}

/// How a finished check ended.
#[derive(Debug, PartialEq)]
enum Outcome {
    Downloaded,
    UpToDate,
    Failed,
}

/// What the user is told. A background check tells nothing; a check the
/// user asked for (directly, or by joining one) always answers.
#[derive(Debug, PartialEq)]
enum Tell {
    Nothing,
    Offer,
    UpToDate,
    Failed,
}

fn tell(outcome: Outcome, asked: bool) -> Tell {
    match (outcome, asked) {
        (_, false) => Tell::Nothing,
        (Outcome::Downloaded, true) => Tell::Offer,
        (Outcome::UpToDate, true) => Tell::UpToDate,
        (Outcome::Failed, true) => Tell::Failed,
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

/// How long quitting waits for an install. A writable bundle is swapped in a
/// second or two; see `install_pending_at_exit` for the case that never ends.
const EXIT_INSTALL_WAIT: Duration = Duration::from_secs(30);

/// Installs a waiting package as the app quits. Called on `RunEvent::Exit`,
/// which is the event macOS's Quit (Cmd+Q, an Apple Event `quit`) reaches;
/// `ExitRequested` is not sent there.
///
/// That runs on the main thread, and on macOS an install that needs
/// administrator rights hands its prompt to the main thread and blocks on it,
/// so installing here directly would hang the quit. The install runs on a
/// worker and the quit waits at most `EXIT_INSTALL_WAIT`. In the admin case
/// the plugin has moved nothing yet when it blocks (the atomic bundle swap
/// failed with a permission error), so exiting leaves the current app intact
/// and the next launch checks again; "Restart Now" handles that case, since
/// the main thread is free then. On Windows the installer takes over and the
/// process exits inside `install`, without relaunching the app the user quit.
pub fn install_pending_at_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    let Some((update, bytes)) = updates.lock().pending.take() else {
        return;
    };
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        dlog!("installing {} on quit", update.version);
        let update = update.restart_after_install(false);
        if let Err(e) = update.install(bytes) {
            eprintln!("[wafflebase-desktop] update install failed: {e}");
        }
        let _ = done.send(());
    });
    if finished.recv_timeout(EXIT_INSTALL_WAIT).is_err() {
        eprintln!(
            "[wafflebase-desktop] update install did not finish on quit; left for the next launch"
        );
    }
}

async fn check<R: Runtime>(app: &AppHandle<R>, manual: bool) {
    let updates = app.state::<Updates>();
    {
        let mut state = updates.lock();
        match begin(state.pending.is_some(), state.busy, manual) {
            Begin::Fetch => state.busy = true,
            Begin::Offer => {
                drop(state);
                prompt_restart(app);
                return;
            }
            Begin::Join => {
                state.answer = true;
                return;
            }
            Begin::Skip => return,
        }
    }

    let result = match tokio::time::timeout(FETCH_TIMEOUT, fetch(app)).await {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err(format!(
            "timed out after {} minutes",
            FETCH_TIMEOUT.as_secs() / 60
        )),
    };

    let (outcome, asked, error) = {
        let mut state = updates.lock();
        state.busy = false;
        let asked = manual || std::mem::take(&mut state.answer);
        match result {
            Ok(Some(downloaded)) => {
                dlog!(
                    "update {} downloaded, installs on quit",
                    downloaded.0.version
                );
                state.pending = Some(downloaded);
                (Outcome::Downloaded, asked, None)
            }
            Ok(None) => (Outcome::UpToDate, asked, None),
            Err(e) => {
                eprintln!("[wafflebase-desktop] update check failed: {e}");
                (Outcome::Failed, asked, Some(e))
            }
        }
    };

    match tell(outcome, asked) {
        Tell::Nothing => {}
        Tell::Offer => prompt_restart(app),
        Tell::UpToDate => {
            let version = app.package_info().version.to_string();
            app.dialog()
                .message(format!("Wafflebase {version} is the latest version."))
                .title("You're up to date")
                .kind(MessageDialogKind::Info)
                .show(|_| {});
        }
        Tell::Failed => {
            let e = error.unwrap_or_default();
            app.dialog()
                .message(format!("Could not check for updates.\n\n{e}"))
                .title("Update check failed")
                .kind(MessageDialogKind::Warning)
                .show(|_| {});
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
        .lock()
        .pending
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
                // Off whatever thread runs this callback, for the reason in
                // `install_pending_at_exit`.
                std::thread::spawn(move || restart_into_update(&handle));
            }
        });
}

fn restart_into_update<R: Runtime>(app: &AppHandle<R>) {
    let updates = app.state::<Updates>();
    let Some((update, bytes)) = updates.lock().pending.take() else {
        return;
    };
    // Windows: the installer runs, exits this process and relaunches the app.
    // macOS: the bundle is replaced in place; relaunch to run it.
    match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(e) => {
            eprintln!("[wafflebase-desktop] update install failed: {e}");
            // Keep the verified package: quitting tries again.
            updates.lock().pending = Some((update, bytes));
            app.dialog()
                .message(format!(
                    "The update could not be installed now. It will be tried \
                     again when you quit.\n\n{e}"
                ))
                .title("Update failed")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_idle_check_fetches_whoever_asks() {
        assert_eq!(begin(false, false, false), Begin::Fetch);
        assert_eq!(begin(false, false, true), Begin::Fetch);
    }

    /// The menu item must answer even when the launch check got there first.
    #[test]
    fn asking_during_a_running_check_joins_it() {
        assert_eq!(begin(false, true, true), Begin::Join);
    }

    #[test]
    fn a_waiting_package_is_offered_not_fetched_again() {
        assert_eq!(begin(true, false, true), Begin::Offer);
        assert_eq!(begin(true, false, false), Begin::Skip);
    }

    #[test]
    fn a_background_check_never_doubles_up() {
        assert_eq!(begin(false, true, false), Begin::Skip);
    }

    #[test]
    fn a_joined_check_answers_the_user() {
        // `asked` is `manual || answer`; a background check that someone
        // joined answers like a manual one.
        assert_eq!(tell(Outcome::Downloaded, true), Tell::Offer);
        assert_eq!(tell(Outcome::UpToDate, true), Tell::UpToDate);
        assert_eq!(tell(Outcome::Failed, true), Tell::Failed);
    }

    /// The app ships with every server release; the background path is silent.
    #[test]
    fn a_background_check_tells_nothing() {
        assert_eq!(tell(Outcome::Downloaded, false), Tell::Nothing);
        assert_eq!(tell(Outcome::UpToDate, false), Tell::Nothing);
        assert_eq!(tell(Outcome::Failed, false), Tell::Nothing);
    }
}
