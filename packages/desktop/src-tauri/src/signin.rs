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

impl SignIn {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> Status {
        self.lock().status.clone().unwrap_or(Status::Idle)
    }

    /// The URL the handoff page may POST to, while a code is waiting.
    pub fn session_post(&self) -> Option<Url> {
        self.lock().session_post.clone()
    }

    /// The handoff material, once. A second call gets nothing, so the
    /// verifier is handed to exactly one page load.
    pub fn take_handoff(&self) -> Option<Handoff> {
        self.lock().handoff.take()
    }

    /// A page finished loading in `label`. Once the sign-in window is back on
    /// the frontend after a handoff, the session POST is no longer expected,
    /// so the navigation policy stops allowing it.
    pub fn page_loaded(&self, label: &str, on_frontend: bool) {
        let mut inner = self.lock();
        if on_frontend
            && inner.status == Some(Status::Done)
            && inner.window.as_deref() == Some(label)
        {
            inner.session_post = None;
            inner.window = None;
            inner.status = None;
        }
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

    fn set_status(&self, generation: u64, status: Status) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        inner.status = Some(status);
        true
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
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| format!("Could not reach {} to start sign-in.", crate::server::origin_string(backend)))?;
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
        Err("This server is too old for desktop sign-in. Ask its administrator to \
             upgrade Wafflebase, or sign in from a web browser."
            .to_string())
    }
}

/// Start desktop sign-in against `backend` in window `label`. Cancels any
/// sign-in already running. Called from the navigation hook (and, in debug
/// builds, from the smoke hook), so it never blocks.
pub fn start<R: Runtime>(app: &AppHandle<R>, label: &str, backend: Url) {
    let state = app.state::<AppState>();
    let generation = {
        let mut inner = state.signin.lock();
        inner.generation += 1;
        if let Some(c) = inner.canceller.take() {
            c.cancel();
        }
        inner.status = Some(Status::Checking);
        inner.window = Some(label.to_string());
        inner.handoff = None;
        inner.session_post = None;
        inner.generation
    };
    dlog!("sign-in started against {}", crate::server::origin_string(&backend));

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
            state.signin.set_status(generation, Status::Failed(message));
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
                    .set_status(generation, Status::Failed(format!("Could not start sign-in: {e}")));
                return;
            }
        };
        dlog!("listener port {}", listener.port());
        {
            let mut inner = state.signin.lock();
            if inner.generation != generation {
                return;
            }
            inner.canceller = Some(listener.canceller());
            inner.status = Some(Status::Waiting);
        }
        if let Err(message) = open_launch_url(&app, listener.launch_url()) {
            state.signin.cancel();
            state.signin.lock().status = Some(Status::Failed(message));
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
                {
                    let mut inner = state.signin.lock();
                    if inner.generation != generation {
                        return;
                    }
                    inner.canceller = None;
                    inner.status = Some(Status::Done);
                    inner.handoff = Some(Handoff {
                        backend: crate::server::origin_string(&backend),
                        code,
                        verifier,
                    });
                    inner.session_post = Some(session_post);
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
                    .set_status(generation, Status::Failed(login::server_refusal_message(&code)));
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.set_focus();
                }
            }
            Outcome::TimedOut(last) => {
                dlog!("sign-in timed out");
                state
                    .signin
                    .set_status(generation, Status::Failed(status_message_for_timeout(last)));
            }
            Outcome::Cancelled => dlog!("sign-in cancelled"),
        }
    });
}
