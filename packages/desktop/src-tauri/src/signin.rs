//! Desktop sign-in, from an intercepted `/auth/github` navigation to the
//! handoff page (`docs/design/desktop-app.md` §3).
//!
//! 1. `GET <backend>/auth/providers` must report `desktop.github === true`,
//!    and on Windows must not report `desktop.windowsOrigin === false`.
//! 2. A loopback listener (`login.rs`) is started with a fresh nonce and PKCE
//!    verifier, and the system browser opens its single-use launch URL.
//! 3. On a valid callback the window is focused and loads the bundled
//!    handoff page, which takes `{ backend, code, verifier }` once through
//!    `take_handoff` and POSTs it to `<backend>/auth/desktop/session`.
//!
//! Only one sign-in runs at a time: starting another cancels the previous
//! listener, and a result from a superseded attempt is dropped.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::login::{self, Canceller, Event, Listener, Outcome};
use crate::{bundled_url, dlog, AppState};

/// What the bundled sign-in page shows.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", content = "message", rename_all = "lowercase")]
pub enum Status {
    Idle,
    Checking,
    Waiting,
    Failed(String),
    Done,
}

/// The one-time material the handoff page redeems.
#[derive(Debug, Clone, Serialize)]
pub struct Handoff {
    pub backend: String,
    pub code: String,
    pub verifier: String,
    /// The sign-in link's `returnTo`, posted along for the backend to
    /// re-validate.
    #[serde(rename = "returnTo")]
    pub return_to: Option<String>,
}

#[derive(Default)]
struct Inner {
    generation: u64,
    status: Option<Status>,
    window: Option<String>,
    canceller: Option<Canceller>,
    handoff: Option<Handoff>,
    session_post: Option<Url>,
}

#[derive(Default)]
pub struct SignIn {
    inner: Mutex<Inner>,
}

/// What a finished page load in the sign-in window means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageCheck {
    /// Nothing to do.
    Fine,
    /// The sign-in window loaded a page that is neither the frontend nor a
    /// bundled page: the sign-in was failed, show the error page.
    Unexpected,
}

impl SignIn {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> Status {
        self.lock().status.clone().unwrap_or(Status::Idle)
    }

    /// Start a new attempt in window `label`, cancelling any running one.
    /// Returns the attempt's generation; results from older ones are dropped.
    fn begin(&self, label: &str) -> u64 {
        let mut inner = self.lock();
        inner.generation += 1;
        if let Some(c) = inner.canceller.take() {
            c.cancel();
        }
        inner.status = Some(Status::Checking);
        inner.window = Some(label.to_string());
        inner.handoff = None;
        inner.session_post = None;
        inner.generation
    }

    /// Hand the listener's canceller to the state, if this attempt is still
    /// the current one. `false` means it was superseded: drop the listener.
    fn arm(&self, generation: u64, canceller: Canceller) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        inner.canceller = Some(canceller);
        inner.status = Some(Status::Waiting);
        true
    }

    /// Fail the current attempt: release its listener and forget its
    /// handoff. A superseded attempt changes nothing.
    fn fail(&self, generation: u64, message: String) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        if let Some(c) = inner.canceller.take() {
            c.cancel();
        }
        inner.status = Some(Status::Failed(message));
        inner.handoff = None;
        inner.session_post = None;
        true
    }

    /// The callback was accepted: keep the handoff for one page load, and
    /// allow window `label` one POST to `session_post`. `label` is the window
    /// the handoff will load in, which is not the one sign-in started in when
    /// that one was closed meanwhile.
    fn complete(&self, generation: u64, label: &str, handoff: Handoff, session_post: Url) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        inner.window = Some(label.to_string());
        inner.canceller = None;
        inner.status = Some(Status::Done);
        inner.handoff = Some(handoff);
        inner.session_post = Some(session_post);
        true
    }

    /// The URL the handoff page in `label` may POST to, while a code is
    /// waiting. Other windows get nothing.
    pub fn session_post_for(&self, label: &str) -> Option<Url> {
        let inner = self.lock();
        if inner.window.as_deref() == Some(label) {
            inner.session_post.clone()
        } else {
            None
        }
    }

    /// Consume the session-POST allowance for a navigation to `url` in
    /// `label`. One navigation gets it; any later one is refused.
    pub fn take_session_post(&self, label: &str, url: &Url) -> bool {
        let mut inner = self.lock();
        let matches = inner.window.as_deref() == Some(label)
            && inner
                .session_post
                .as_ref()
                .is_some_and(|t| t.origin() == url.origin() && t.path() == url.path());
        if matches {
            inner.session_post = None;
        }
        matches
    }

    /// Window `label` was sent away from the frontend's origin after its
    /// session POST: the backend's `FRONTEND_URL` is not the server chosen in
    /// the app (an alias, a `www.` variant). Fail the sign-in so the window
    /// says so instead of waiting on the handoff page. `false` when `label`
    /// has no spent session POST, so the redirect is any other link.
    pub fn redirected_away_after_post(&self, label: &str) -> bool {
        let mut inner = self.lock();
        let spent = inner.window.as_deref() == Some(label)
            && inner.status == Some(Status::Done)
            && inner.session_post.is_none();
        if spent {
            inner.handoff = None;
            inner.status = Some(Status::Failed(
                "The server did not send you back to Wafflebase. Check that the address \
                 you chose is the server's own address (its FRONTEND_URL)."
                    .to_string(),
            ));
        }
        spent
    }

    /// The handoff material, once, to the handoff page in the window the
    /// sign-in finishes in. A second call, or a call from any other window (a
    /// stale handoff page left in one an earlier attempt ran in), gets
    /// nothing, so the verifier is handed to exactly one page load.
    pub fn take_handoff(&self, label: &str) -> Option<Handoff> {
        let mut inner = self.lock();
        if inner.window.as_deref() != Some(label) {
            return None;
        }
        inner.handoff.take()
    }

    /// A page finished loading in `label`. Back on the frontend after a
    /// handoff, the sign-in is over. Anything that is neither the frontend nor
    /// a bundled page, while a sign-in is running in that window, is wrong:
    /// the backend answers the session POST with a redirect to the frontend,
    /// so a page rendered from anywhere else (an error, or a server that is
    /// not the one the frontend sent us to) must not stay on screen in a
    /// window with no address bar.
    pub fn page_loaded(&self, label: &str, on_frontend: bool, bundled: bool) -> PageCheck {
        let mut inner = self.lock();
        let running = matches!(
            inner.status,
            Some(Status::Checking | Status::Waiting | Status::Done)
        );
        if !running || inner.window.as_deref() != Some(label) || bundled {
            return PageCheck::Fine;
        }
        if on_frontend {
            if inner.status == Some(Status::Done) {
                inner.session_post = None;
                inner.handoff = None;
                inner.window = None;
                inner.status = None;
            }
            return PageCheck::Fine;
        }
        // A new generation, as `cancel` does: a worker still checking the
        // server must not arm a listener or complete over this failure.
        inner.generation += 1;
        if let Some(c) = inner.canceller.take() {
            c.cancel();
        }
        inner.handoff = None;
        inner.session_post = None;
        inner.status = Some(Status::Failed(
            "Sign-in did not finish: the server answered with a page this app does not \
             expect. Try again, or ask the server's administrator."
                .to_string(),
        ));
        PageCheck::Unexpected
    }

    /// Cancel the running sign-in if it runs in window `label`. A page left
    /// in a window an earlier, superseded attempt ran in must not cancel the
    /// attempt running in another one.
    pub fn cancel_in(&self, label: &str) -> bool {
        // One guard for the check and the cancel: released in between, a
        // `begin` in another window could slip in and be the one cancelled.
        let mut inner = self.lock();
        if inner.window.as_deref() != Some(label) {
            return false;
        }
        Self::cancel_locked(&mut inner);
        true
    }

    /// Cancel the running sign-in, if any. Returns the window it ran in.
    pub fn cancel(&self) -> Option<String> {
        Self::cancel_locked(&mut self.lock())
    }

    fn cancel_locked(inner: &mut Inner) -> Option<String> {
        inner.generation += 1;
        if let Some(c) = inner.canceller.take() {
            c.cancel();
        }
        inner.status = None;
        inner.handoff = None;
        inner.session_post = None;
        inner.window.take()
    }
}

fn status_message_for_timeout(last: Option<login::Refusal>) -> String {
    let base = "Sign-in timed out. Try again.".to_string();
    match last {
        Some(r) => format!("{base} The last callback was refused: {}", r.message()),
        None => base,
    }
}

/// The browser opener for the launch URL. Debug builds can swap in an
/// executable for unattended smoke tests (`WAFFLEBASE_DESKTOP_BROWSER`).
fn open_launch_url<R: Runtime>(app: &AppHandle<R>, launch_url: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if let Some(exe) = std::env::var_os("WAFFLEBASE_DESKTOP_BROWSER") {
        dlog!("opening the launch URL with WAFFLEBASE_DESKTOP_BROWSER");
        return std::process::Command::new(exe)
            .arg(launch_url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not start WAFFLEBASE_DESKTOP_BROWSER: {e}"));
    }
    app.opener()
        .open_url(launch_url, None::<&str>)
        .map_err(|e| format!("Could not open the system browser: {e}"))
}

#[derive(serde::Deserialize)]
struct Providers {
    desktop: Option<DesktopProviders>,
}

#[derive(serde::Deserialize)]
struct DesktopProviders {
    github: Option<bool>,
    /// Whether the server accepts `http://tauri.localhost` as a handoff
    /// origin. Only Windows hands off from it — macOS and Linux use
    /// `tauri://localhost`, which the server always accepts. Absent on a
    /// server that predates the field, which accepted it unconditionally.
    #[serde(rename = "windowsOrigin")]
    windows_origin: Option<bool>,
}

/// This platform's verdict on a server's `desktop` sign-in answer.
///
/// `windows` is whether this build's webview hands off from
/// `http://tauri.localhost`. A server that refuses that origin
/// (`WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false`) would 403 the handoff POST at
/// the very end, after the user signed in — so Windows refuses here instead,
/// while macOS and Linux are unaffected by the setting.
fn desktop_signin_verdict(desktop: Option<&DesktopProviders>, windows: bool) -> Result<(), String> {
    match desktop.and_then(|d| d.github) {
        Some(true) => {}
        // A current server that cannot run the loopback login: it reports
        // the same for the CLI. See `cliLoginAvailable` in the backend.
        Some(false) => {
            return Err(
                "This server has desktop sign-in turned off: it needs an https sign-in \
                 address, or COOKIE_SECURE=true behind a TLS proxy. Ask its \
                 administrator, or sign in from a web browser."
                    .to_string(),
            )
        }
        None => {
            return Err(
                "This server is too old for desktop sign-in. Ask its administrator to \
                 upgrade Wafflebase, or sign in from a web browser."
                    .to_string(),
            )
        }
    }
    if windows && desktop.and_then(|d| d.windows_origin) == Some(false) {
        return Err(
            "This server does not accept sign-in from the Windows app's window \
             (WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false). Ask its administrator, or \
             sign in from a web browser."
                .to_string(),
        );
    }
    Ok(())
}

async fn check_providers(backend: &Url) -> Result<(), String> {
    let url = backend.join("/auth/providers").map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|_| {
        format!(
            "Could not reach {} to start sign-in.",
            crate::server::origin_string(backend)
        )
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "{} answered {} when asked how to sign in.",
            crate::server::origin_string(backend),
            response.status().as_u16()
        ));
    }
    let providers: Providers = response
        .json()
        .await
        .map_err(|_| "The server's sign-in options could not be read.".to_string())?;
    desktop_signin_verdict(providers.desktop.as_ref(), cfg!(windows))
}

/// Start desktop sign-in against `backend` in window `label`. Cancels any
/// sign-in already running. Called from the navigation hook (and, in debug
/// builds, from the smoke hook), so it never blocks.
pub fn start<R: Runtime>(app: &AppHandle<R>, label: &str, backend: Url, return_to: Option<String>) {
    let state = app.state::<AppState>();
    let generation = state.signin.begin(label);
    dlog!(
        "sign-in started against {}",
        crate::server::origin_string(&backend)
    );

    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.navigate(bundled_url("signin.html"));
        }
        let state = app.state::<AppState>();

        // The navigation hook already sends a plaintext remote backend to
        // the system browser instead of here (`navigation::is_secure_origin`).
        // Checked again at the one place that puts the verifier and the code
        // on the wire, so no other caller — the debug smoke hook, a later
        // entry point — can start a cleartext exchange.
        if !crate::navigation::is_secure_origin(&backend) {
            state.signin.fail(
                generation,
                format!(
                    "{} is not a secure address: desktop sign-in needs https:// \
                     (plain http:// works only for localhost). Ask its \
                     administrator, or sign in from a web browser.",
                    crate::server::origin_string(&backend)
                ),
            );
            return;
        }

        let checked = check_providers(&backend).await;
        dlog!(
            "providers checked: {}",
            match &checked {
                Ok(()) => "desktop.github is true".to_string(),
                Err(e) => e.clone(),
            }
        );
        if let Err(message) = checked {
            state.signin.fail(generation, message);
            return;
        }

        let nonce = login::create_nonce();
        let verifier = login::create_verifier();
        let challenge = login::pkce_challenge(&verifier);
        let listener = match Listener::start(&nonce, |port| {
            login::authorization_url(&backend, port, &nonce, &challenge)
        }) {
            Ok(l) => l,
            Err(e) => {
                state
                    .signin
                    .fail(generation, format!("Could not start sign-in: {e}"));
                return;
            }
        };
        dlog!("listener port {}", listener.port());
        if !state.signin.arm(generation, listener.canceller()) {
            return;
        }
        if let Err(message) = open_launch_url(&app, listener.launch_url()) {
            state.signin.fail(generation, message);
            return;
        }

        let outcome = tauri::async_runtime::spawn_blocking(move || {
            listener.wait(login::CALLBACK_TIMEOUT, |event| match event {
                Event::LaunchRedirected => dlog!("launch link redirected to the server"),
                Event::LaunchSpent => dlog!("launch link visited again (410)"),
                Event::Refused(r) => dlog!("callback refused: {}", r.message()),
            })
        })
        .await
        .unwrap_or(Outcome::Cancelled);

        match outcome {
            Outcome::Code(code) => {
                dlog!("callback accepted");
                let session_post = backend
                    .join("/auth/desktop/session")
                    .expect("a backend origin joins a path");
                let handoff = Handoff {
                    backend: crate::server::origin_string(&backend),
                    code,
                    verifier,
                    return_to,
                };
                // The window sign-in started in may have been closed while
                // the browser was open; finish in another one.
                let Some(window) = crate::window_or_any(&app, &label) else {
                    state.signin.fail(
                        generation,
                        "Sign-in finished after every window was closed.".to_string(),
                    );
                    return;
                };
                if !state
                    .signin
                    .complete(generation, window.label(), handoff, session_post)
                {
                    return;
                }
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.navigate(bundled_url("handoff.html"));
            }
            Outcome::ServerRefused(code) => {
                dlog!("callback carried a server refusal");
                state
                    .signin
                    .fail(generation, login::server_refusal_message(&code));
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.set_focus();
                }
            }
            Outcome::TimedOut(last) => {
                dlog!("sign-in timed out");
                state
                    .signin
                    .fail(generation, status_message_for_timeout(last));
            }
            Outcome::Cancelled => dlog!("sign-in cancelled"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn desktop(github: Option<bool>, windows_origin: Option<bool>) -> DesktopProviders {
        DesktopProviders {
            github,
            windows_origin,
        }
    }

    /// The preflight's whole reading of `/auth/providers`, platform by
    /// platform. A server whose Windows handoff origin is off must stop a
    /// Windows sign-in before the browser opens, and must not touch the
    /// other two platforms, which hand off from `tauri://localhost`.
    #[test]
    fn a_refused_windows_origin_stops_only_windows() {
        let off = desktop(Some(true), Some(false));
        assert!(desktop_signin_verdict(Some(&off), true).is_err());
        assert!(desktop_signin_verdict(Some(&off), false).is_ok());

        let on = desktop(Some(true), Some(true));
        assert!(desktop_signin_verdict(Some(&on), true).is_ok());
        assert!(desktop_signin_verdict(Some(&on), false).is_ok());

        // A server that predates the field accepted the origin
        // unconditionally, so its silence is not a refusal.
        let old = desktop(Some(true), None);
        assert!(desktop_signin_verdict(Some(&old), true).is_ok());
    }

    #[test]
    fn a_server_without_desktop_sign_in_is_refused_everywhere() {
        for windows in [true, false] {
            // Too old for desktop sign-in at all.
            assert!(desktop_signin_verdict(None, windows).is_err());
            assert!(desktop_signin_verdict(Some(&desktop(None, Some(true))), windows).is_err());
            // Current, but the loopback login is gated off.
            assert!(
                desktop_signin_verdict(Some(&desktop(Some(false), Some(true))), windows).is_err()
            );
        }
    }

    fn handoff() -> Handoff {
        Handoff {
            backend: "https://api.example.com".into(),
            code: "c".into(),
            verifier: "v".into(),
            return_to: None,
        }
    }

    /// A real listener whose wait runs on a thread; the receiver reports how
    /// the wait ended.
    fn listener() -> (Canceller, mpsc::Receiver<Outcome>) {
        let listener = Listener::start("n", |port| {
            login::authorization_url(&u("https://api.example.com"), port, "n", "c")
        })
        .unwrap();
        let canceller = listener.canceller();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = tx.send(listener.wait(Duration::from_secs(30), |_| {}));
        });
        (canceller, rx)
    }

    #[test]
    fn failing_releases_the_listener() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        let (canceller, outcome) = listener();
        assert!(signin.arm(generation, canceller));
        assert_eq!(signin.status(), Status::Waiting);
        assert!(signin.fail(generation, "timed out".into()));
        assert_eq!(signin.status(), Status::Failed("timed out".into()));
        assert_eq!(
            outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Cancelled
        );
    }

    #[test]
    fn a_superseded_attempt_changes_nothing() {
        let signin = SignIn::default();
        let old = signin.begin("main");
        let new = signin.begin("main");
        assert!(!signin.fail(old, "could not open the browser".into()));
        assert_eq!(signin.status(), Status::Checking);
        let (canceller, outcome) = listener();
        assert!(!signin.arm(old, canceller.clone()));
        canceller.cancel();
        assert_eq!(
            outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Cancelled
        );
        assert!(!signin.complete(
            old,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session")
        ));
        assert!(signin.session_post_for("main").is_none());
        assert!(signin.complete(
            new,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session")
        ));
    }

    #[test]
    fn a_new_attempt_cancels_the_running_listener() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        let (canceller, outcome) = listener();
        assert!(signin.arm(generation, canceller));
        signin.begin("main");
        assert_eq!(
            outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Cancelled
        );
    }

    #[test]
    fn session_post_is_one_shot_and_scoped_to_the_sign_in_window() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        let post = u("https://api.example.com/auth/desktop/session");
        assert!(signin.complete(generation, "main", handoff(), post.clone()));
        assert!(signin.session_post_for("window-2").is_none());
        assert_eq!(signin.session_post_for("main"), Some(post.clone()));
        assert!(!signin.take_session_post("window-2", &post));
        assert!(!signin.take_session_post("main", &u("https://evil.example/auth/desktop/session")));
        assert!(signin.take_session_post("main", &post));
        assert!(
            !signin.take_session_post("main", &post),
            "a second POST is refused"
        );
        assert!(signin.session_post_for("main").is_none());
    }

    #[test]
    fn completing_in_another_window_moves_the_session_post_there() {
        let signin = SignIn::default();
        let generation = signin.begin("window-1");
        let post = u("https://api.example.com/auth/desktop/session");
        assert!(signin.complete(generation, "main", handoff(), post.clone()));
        assert!(signin.session_post_for("window-1").is_none());
        assert_eq!(signin.session_post_for("main"), Some(post));
    }

    #[test]
    fn a_redirect_away_after_the_session_post_fails_the_sign_in() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        let post = u("https://api.example.com/auth/desktop/session");
        signin.complete(generation, "main", handoff(), post.clone());
        assert!(
            !signin.redirected_away_after_post("main"),
            "the POST is not spent yet"
        );
        assert!(signin.take_session_post("main", &post));
        assert!(!signin.redirected_away_after_post("window-2"));
        assert!(signin.redirected_away_after_post("main"));
        assert!(matches!(signin.status(), Status::Failed(_)));
        assert!(
            !signin.redirected_away_after_post("main"),
            "once failed, other links are links"
        );
    }

    #[test]
    fn handoff_is_handed_out_once() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session"),
        );
        assert!(signin.take_handoff("main").is_some());
        assert!(signin.take_handoff("main").is_none());
    }

    #[test]
    fn landing_on_the_frontend_after_handoff_ends_the_sign_in() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session"),
        );
        assert_eq!(
            signin.page_loaded("main", false, true),
            PageCheck::Fine,
            "handoff page"
        );
        assert_eq!(signin.page_loaded("main", true, false), PageCheck::Fine);
        assert_eq!(signin.status(), Status::Idle);
        assert!(signin.session_post_for("main").is_none());
    }

    #[test]
    fn an_unexpected_page_in_the_sign_in_window_fails_it() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
            "main",
            handoff(),
            u("https://evil.example/auth/desktop/session"),
        );
        // The session response rendered instead of redirecting.
        assert_eq!(
            signin.page_loaded("main", false, false),
            PageCheck::Unexpected
        );
        assert!(matches!(signin.status(), Status::Failed(_)));
        assert!(signin.session_post_for("main").is_none());
        assert!(signin.take_handoff("main").is_none());
    }

    #[test]
    fn unexpected_page_check_ignores_other_windows_and_idle_state() {
        let signin = SignIn::default();
        assert_eq!(
            signin.page_loaded("main", false, false),
            PageCheck::Fine,
            "no sign-in"
        );
        let generation = signin.begin("main");
        let (canceller, outcome) = listener();
        signin.arm(generation, canceller);
        assert_eq!(
            signin.page_loaded("window-2", false, false),
            PageCheck::Fine
        );
        assert_eq!(signin.status(), Status::Waiting);
        // While waiting, the sign-in window showing a foreign page fails it
        // and releases the listener.
        assert_eq!(
            signin.page_loaded("main", false, false),
            PageCheck::Unexpected
        );
        assert_eq!(
            outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Cancelled
        );
        // Once failed, nothing more happens.
        assert_eq!(signin.page_loaded("main", false, false), PageCheck::Fine);
    }

    #[test]
    fn a_page_load_failure_drops_the_workers_later_results() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        // Still checking the server when the window shows a foreign page.
        assert_eq!(
            signin.page_loaded("main", false, false),
            PageCheck::Unexpected
        );
        let (canceller, _outcome) = listener();
        assert!(!signin.arm(generation, canceller), "armed after failing");
        assert!(!signin.complete(
            generation,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session"),
        ));
        assert!(matches!(signin.status(), Status::Failed(_)));
        assert!(signin.take_handoff("main").is_none());
    }

    #[test]
    fn handoff_goes_only_to_the_window_the_sign_in_finishes_in() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
            "main",
            handoff(),
            u("https://api.example.com/auth/desktop/session"),
        );
        assert!(signin.take_handoff("window-2").is_none());
        assert!(signin.take_handoff("main").is_some());
    }

    #[test]
    fn cancel_in_leaves_a_sign_in_in_another_window_running() {
        let signin = SignIn::default();
        signin.begin("window-1");
        let generation = signin.begin("window-2");
        let (canceller, outcome) = listener();
        assert!(signin.arm(generation, canceller));
        // window-1 still shows the page of the attempt window-2 replaced.
        assert!(!signin.cancel_in("window-1"));
        assert_eq!(signin.status(), Status::Waiting);
        assert!(outcome.recv_timeout(Duration::from_millis(50)).is_err());
        assert!(signin.cancel_in("window-2"));
        assert_eq!(signin.status(), Status::Idle);
    }
}
