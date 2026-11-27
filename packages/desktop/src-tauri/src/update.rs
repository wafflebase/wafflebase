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

use std::path::Path;
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

/// How long quitting waits for an install on Windows, where the installer
/// takes over and the process exits inside `install`.
#[cfg(not(target_os = "macos"))]
const EXIT_INSTALL_WAIT: Duration = Duration::from_secs(30);

/// Installs a waiting package as the app quits. Called on `RunEvent::Exit`,
/// which is the event macOS's Quit (Cmd+Q, an Apple Event `quit`) reaches;
/// `ExitRequested` is not sent there.
///
/// macOS: the quit must not end the process while the bundle is being
/// replaced. Where the file system cannot swap the two bundles in one step,
/// the plugin moves the current app away and then the new one in, and an
/// exit between the two leaves nothing at the install path. So the install
/// runs to the end here, with no time limit. That is only safe while the
/// plugin never needs the main thread, which this is: an install that needs
/// administrator rights hands its prompt to the main thread and blocks on
/// it. So the quit first decides which case it is in (`at_exit`). A bundle
/// this user can replace is installed; one they cannot (an app put by an
/// administrator in a folder this user cannot write) is left alone, the next
/// launch checks again, and "Restart Now", with the main thread free, is the
/// way to install it.
///
/// Windows: the installer takes over and the process exits inside `install`,
/// without relaunching the app the user quit.
pub fn install_pending_at_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    let Some((update, bytes)) = updates.lock().pending.take() else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        if at_exit(bundle_path().as_deref()) == AtExit::Skip {
            eprintln!(
                "[wafflebase-desktop] update {} needs administrator rights; not installing on \
                 quit (Check for Updates… then Restart Now installs it)",
                update.version
            );
            return;
        }
        dlog!("installing {} on quit", update.version);
        let update = update.restart_after_install(false);
        if let Err(e) = update.install(bytes) {
            eprintln!("[wafflebase-desktop] update install failed: {e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
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
}

/// What quitting does with a waiting package on macOS.
#[derive(Debug, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
enum AtExit {
    /// This user can replace the bundle: the plugin renames it on the
    /// installing thread, so the quit can wait for it to finish.
    Install,
    /// They cannot: the plugin would ask for administrator rights on the
    /// main thread, which is the thread the quit is holding.
    Skip,
}

/// The plugin takes the privileged route on a permission error from
/// renaming the bundle, which needs write access to the folder holding it
/// and, to move a folder to another parent, to the bundle itself. Probed by
/// creating a file in each, which is refused for the same reasons (App
/// Management included). A writable folder is not enough when it is sticky
/// (`/Applications` set up that way, a shared folder): there only the owner
/// of an entry or of the folder may rename it, so another user's bundle
/// would still take the privileged route. `bundle` is `None` when there is
/// none to replace.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn at_exit(bundle: Option<&Path>) -> AtExit {
    let Some(bundle) = bundle else {
        return AtExit::Skip;
    };
    let Some(parent) = bundle.parent() else {
        return AtExit::Skip;
    };
    // The probe file is owned by whoever this process writes as.
    let (Some(me), true) = (probe_owner(parent), writable(bundle)) else {
        return AtExit::Skip;
    };
    match owners(parent, bundle) {
        Some(o) if sticky_allows_rename(o.dir_sticky, o.dir_owner, o.bundle_owner, me) => {
            AtExit::Install
        }
        _ => AtExit::Skip,
    }
}

/// rename(2) in a sticky folder: allowed to the entry's owner or the
/// folder's owner only. A folder without the sticky bit adds no condition.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn sticky_allows_rename(dir_sticky: bool, dir_owner: u32, bundle_owner: u32, me: u32) -> bool {
    !dir_sticky || bundle_owner == me || dir_owner == me
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Owners {
    dir_sticky: bool,
    dir_owner: u32,
    bundle_owner: u32,
}

#[cfg(unix)]
fn owners(dir: &Path, bundle: &Path) -> Option<Owners> {
    use std::os::unix::fs::MetadataExt;
    let d = std::fs::metadata(dir).ok()?;
    let b = std::fs::metadata(bundle).ok()?;
    Some(Owners {
        dir_sticky: d.mode() & 0o1000 != 0,
        dir_owner: d.uid(),
        bundle_owner: b.uid(),
    })
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn owners(_dir: &Path, _bundle: &Path) -> Option<Owners> {
    None
}

/// The owner a file created in `dir` gets, i.e. this process's effective
/// user, when it can create one there; `None` when it cannot write there.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn probe_owner(dir: &Path) -> Option<u32> {
    let probe = dir.join(format!(".wafflebase-update-probe-{}", std::process::id()));
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe)
        .ok()?;
    let owner = file_owner(&probe);
    let _ = std::fs::remove_file(&probe);
    owner
}

#[cfg(unix)]
fn file_owner(path: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|m| m.uid())
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn file_owner(_path: &Path) -> Option<u32> {
    None
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".wafflebase-update-probe-{}", std::process::id()));
    let created = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe)
        .is_ok();
    if created {
        let _ = std::fs::remove_file(&probe);
    }
    created
}

/// The `.app` bundle the updater replaces, found the way the plugin finds it.
#[cfg(target_os = "macos")]
fn bundle_path() -> Option<std::path::PathBuf> {
    let exe = tauri::utils::platform::current_exe().ok()?;
    tauri_plugin_updater::extract_path_from_executable(&exe).ok()
}

/// Whether a finished check answers the user: they asked for it, or asked
/// while it ran. The join flag is cleared either way; left set by a manual
/// check that someone joined, it would make the next background check speak.
fn take_asked(manual: bool, joined: &mut bool) -> bool {
    let joined = std::mem::take(joined);
    manual || joined
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
        let asked = take_asked(manual, &mut state.answer);
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
        // A background check that someone joined answers like a manual one.
        let mut joined = true;
        assert!(take_asked(false, &mut joined));
        assert_eq!(tell(Outcome::Downloaded, true), Tell::Offer);
        assert_eq!(tell(Outcome::UpToDate, true), Tell::UpToDate);
        assert_eq!(tell(Outcome::Failed, true), Tell::Failed);
    }

    /// A menu request that joined a manual check is answered by it, and must
    /// not make the next background check open a dialog nobody asked for.
    #[test]
    fn joining_a_manual_check_is_used_up_by_it() {
        let mut joined = true;
        assert!(take_asked(true, &mut joined));
        assert!(!joined);
        assert!(!take_asked(false, &mut joined));
    }

    // Only the Unix-only quit-time tests use it.
    #[cfg(unix)]
    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wafflebase-update-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Wafflebase.app")).unwrap();
        dir
    }

    // The quit-time install decision is macOS's; it reads file ownership,
    // which only Unix has.
    #[cfg(unix)]
    #[test]
    fn a_bundle_this_user_can_replace_is_installed_at_quit() {
        let dir = scratch_dir("writable");
        let bundle = dir.join("Wafflebase.app");
        assert_eq!(at_exit(Some(&bundle)), AtExit::Install);
        // The probes leave nothing behind.
        assert_eq!(std::fs::read_dir(&bundle).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_bundle_is_not_installed_at_quit() {
        assert_eq!(at_exit(None), AtExit::Skip);
        let missing = std::env::temp_dir().join("wafflebase-update-test-missing/Wafflebase.app");
        assert_eq!(at_exit(Some(&missing)), AtExit::Skip);
    }

    /// The case whose administrator prompt would need the main thread.
    #[cfg(unix)]
    #[test]
    fn a_bundle_needing_administrator_rights_is_left_at_quit() {
        use std::os::unix::fs::PermissionsExt;
        let read_only = std::fs::Permissions::from_mode(0o555);
        let writable_again = std::fs::Permissions::from_mode(0o755);
        for locked in ["folder", "bundle"] {
            let dir = scratch_dir(locked);
            let bundle = dir.join("Wafflebase.app");
            let target = if locked == "folder" { &dir } else { &bundle };
            std::fs::set_permissions(target, read_only.clone()).unwrap();
            // Root writes anyway; nothing to learn from this run then.
            if !writable(target) {
                assert_eq!(at_exit(Some(&bundle)), AtExit::Skip, "{locked}");
            }
            std::fs::set_permissions(target, writable_again.clone()).unwrap();
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    /// rename(2)'s sticky-folder rule: a writable sticky folder still refuses
    /// to let one user rename another's bundle, and the plugin would then go
    /// the privileged way on the main thread the quit is holding.
    #[test]
    fn a_sticky_folder_allows_renaming_only_your_own_bundle() {
        let (me, other) = (501, 502);
        assert!(sticky_allows_rename(false, other, other, me));
        assert!(sticky_allows_rename(true, other, me, me));
        assert!(sticky_allows_rename(true, me, other, me));
        assert!(!sticky_allows_rename(true, other, other, me));
    }

    /// The app ships with every server release; the background path is silent.
    #[test]
    fn a_background_check_tells_nothing() {
        assert_eq!(tell(Outcome::Downloaded, false), Tell::Nothing);
        assert_eq!(tell(Outcome::UpToDate, false), Tell::Nothing);
        assert_eq!(tell(Outcome::Failed, false), Tell::Nothing);
    }
}
