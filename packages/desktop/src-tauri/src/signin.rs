//! Desktop sign-in, from an intercepted `/auth/github` navigation to the
//! handoff page (`docs/design/desktop-app.md` §3).
//!
//! 1. `GET <backend>/auth/providers` must report `desktop.github === true`.
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
    /// allow the sign-in window one POST to `session_post`.
    fn complete(&self, generation: u64, handoff: Handoff, session_post: Url) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
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

    /// The handoff material, once. A second call gets nothing, so the
    /// verifier is handed to exactly one page load.
    pub fn take_handoff(&self) -> Option<Handoff> {
        self.lock().handoff.take()
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

    /// Cancel the running sign-in, if any. Returns the window it ran in.
    pub fn cancel(&self) -> Option<String> {
        let mut inner = self.lock();
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
    if providers.desktop.and_then(|d| d.github) == Some(true) {
        Ok(())
    } else {
        Err(
            "This server is too old for desktop sign-in. Ask its administrator to \
             upgrade Wafflebase, or sign in from a web browser."
                .to_string(),
        )
    }
}

/// Start desktop sign-in against `backend` in window `label`. Cancels any
/// sign-in already running. Called from the navigation hook (and, in debug
/// builds, from the smoke hook), so it never blocks.
pub fn start<R: Runtime>(app: &AppHandle<R>, label: &str, backend: Url) {
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
                };
                if !state.signin.complete(generation, handoff, session_post) {
                    return;
                }
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.navigate(bundled_url("handoff.html"));
                }
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

    fn handoff() -> Handoff {
        Handoff {
            backend: "https://api.example.com".into(),
            code: "c".into(),
            verifier: "v".into(),
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
            handoff(),
            u("https://api.example.com/auth/desktop/session")
        ));
        assert!(signin.session_post_for("main").is_none());
        assert!(signin.complete(
            new,
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
        assert!(signin.complete(generation, handoff(), post.clone()));
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
    fn handoff_is_handed_out_once() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
            handoff(),
            u("https://api.example.com/auth/desktop/session"),
        );
        assert!(signin.take_handoff().is_some());
        assert!(signin.take_handoff().is_none());
    }

    #[test]
    fn landing_on_the_frontend_after_handoff_ends_the_sign_in() {
        let signin = SignIn::default();
        let generation = signin.begin("main");
        signin.complete(
            generation,
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
        assert!(signin.take_handoff().is_none());
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
}
