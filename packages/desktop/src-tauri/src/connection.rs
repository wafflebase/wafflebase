//! Whether the chosen server answers, checked before a window is sent to it,
//! and the bundled unreachable-server page while it does not
//! (`docs/design/desktop-app.md` §2).
//!
//! A webview that cannot reach its page shows nothing: WKWebView reports a
//! failed first load to no callback wry forwards, and WebView2 reports it as
//! an ordinary `Finished`. So instead of waiting for a failure the shell
//! cannot see, it asks first. `open` probes the server's start URL from Rust
//! and loads it only once something answers. If it does not, the start page
//! is loaded once anyway, in case a Service Worker serves the cached app
//! (design §10); if none does, the window shows `offline.html`, and the
//! probe repeats on a backoff (2 s doubling to 30 s) and opens the server as
//! soon as it answers.
//!
//! Only one probe runs at a time. Opening a server again, leaving the page,
//! changing server or closing the window cancels the running one at once.

use std::future::{poll_fn, Future};
use std::pin::pin;
use std::sync::Mutex;
use std::task::Poll;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};
use tokio::sync::Notify;
use url::Url;

use crate::{bundled_url, dlog, log_url, navigation, server, AppState};

/// The bundled unreachable-server page.
pub const OFFLINE_PAGE: &str = "offline.html";

/// How long a first probe may take before the window shows the page in its
/// "Connecting…" state rather than nothing.
const SHOW_CHECKING_AFTER: Duration = Duration::from_millis(1500);

/// How long to wait for a connection (DNS, TCP and TLS). Failing this means
/// the server is out of reach.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// How long to wait for the whole answer. Failing this after connecting
/// means the server is up but slow, which the webview can wait for itself.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(15);

const FIRST_RETRY: Duration = Duration::from_secs(2);
const LONGEST_RETRY: Duration = Duration::from_secs(30);

/// The wait before retry number `attempt` (0-based): 2, 4, 8, 16, then 30
/// seconds from there on, the schedule Rocket.Chat's desktop app uses.
pub fn retry_delay(attempt: u32) -> Duration {
    let factor = 1u32.checked_shl(attempt).unwrap_or(u32::MAX);
    FIRST_RETRY.saturating_mul(factor).min(LONGEST_RETRY)
}

/// What one probe request came back with, reduced to what decides it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// An HTTP response, whatever its status.
    Answered,
    /// No response. `connect` is reqwest's `is_connect` (DNS, TCP, TLS or
    /// proxy), `dns` its `is_dns`, `timeout` its `is_timeout`.
    Failed {
        connect: bool,
        dns: bool,
        timeout: bool,
    },
}

/// Why a server is out of reach, for the page to put in words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Cause {
    /// The name did not resolve: offline, or a mistyped address.
    Dns,
    /// The connection was refused or failed (TLS included, which is what a
    /// captive portal intercepting `https://` produces).
    Connect,
    /// Nothing answered the connection attempt in time.
    Timeout,
    /// Connected, then the connection ended before any answer.
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Reachable,
    Unreachable(Cause),
}

/// Any HTTP answer means the server is there, a 4xx or 5xx included: a
/// self-hosted deployment may answer `/login` with anything, and what the
/// page then shows is the deployment's business. Only a failure to get an
/// answer means unreachable, and a timeout only when it happened while
/// connecting: a server that accepted the connection and is slow to answer
/// is up, and the webview can wait for it as long as it likes.
pub fn verdict(probe: Probe) -> Verdict {
    match probe {
        Probe::Answered => Verdict::Reachable,
        Probe::Failed {
            connect: true,
            dns: true,
            ..
        } => Verdict::Unreachable(Cause::Dns),
        Probe::Failed {
            connect: true,
            timeout: true,
            ..
        } => Verdict::Unreachable(Cause::Timeout),
        Probe::Failed { connect: true, .. } => Verdict::Unreachable(Cause::Connect),
        Probe::Failed { timeout: true, .. } => Verdict::Reachable,
        Probe::Failed { .. } => Verdict::Unreachable(Cause::Closed),
    }
}

/// Whether `url` is the bundled unreachable-server page.
pub fn is_offline_page(url: &Url) -> bool {
    navigation::is_bundled(url) && url.path() == format!("/{OFFLINE_PAGE}")
}

/// What an attempt does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// The server answered: load its start page.
    Open,
    /// It did not, but load the start page anyway: a Service Worker from an
    /// earlier visit may serve the cached app (design §10).
    TryCachedUi,
    /// Show (or keep) the offline page and probe again after the backoff.
    ShowOffline,
    /// The cached app booted, and handles the outage with its own offline
    /// screen: the shell steps aside.
    LeaveToCachedUi,
}

/// After a probe. The cached app is tried once per attempt, on its first
/// probe, and not when the attempt began on the offline page (Try again,
/// `online`): that page is only showing because the cached app did not boot.
pub fn after_probe(verdict: Verdict, attempt: u32, began_on_offline_page: bool) -> Next {
    match verdict {
        Verdict::Reachable => Next::Open,
        Verdict::Unreachable(_) if attempt == 0 && !began_on_offline_page => Next::TryCachedUi,
        Verdict::Unreachable(_) => Next::ShowOffline,
    }
}

/// How loading the start page went while the server was unreachable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CachedUi {
    /// The frontend never committed: on macOS a failed load fires no
    /// page-load event, so this is what "no worker" looks like there.
    NotCommitted,
    /// It committed, and the document is (or is not) controlled by a
    /// Service Worker. Committing alone proves nothing: WebView2 commits and
    /// finishes its own error page under the frontend's URL.
    Committed { controlled: bool },
}

pub fn after_cached_try(cached: CachedUi) -> Next {
    match cached {
        CachedUi::Committed { controlled: true } => Next::LeaveToCachedUi,
        CachedUi::NotCommitted | CachedUi::Committed { controlled: false } => Next::ShowOffline,
    }
}

/// Run in the frontend's page to ask whether a Service Worker served it.
const CONTROLLER_CHECK: &str = "!!(navigator.serviceWorker && navigator.serviceWorker.controller)";

/// `eval_with_callback` hands back the script's value serialized as JSON;
/// anything but `true` (an error, `null`, no answer) counts as no worker.
pub fn controller_answer(result: &str) -> bool {
    result.trim() == "true"
}

/// How long the start page may take to commit while the server is
/// unreachable. A worker serves from disk; without one, macOS never commits.
const CACHED_UI_COMMIT_WAIT: Duration = Duration::from_secs(3);

/// How long a committed cached app may take to finish loading before it is
/// asked about its worker anyway.
const CACHED_UI_FINISH_WAIT: Duration = Duration::from_secs(10);

/// How long the controller check may take to answer.
const CONTROLLER_CHECK_WAIT: Duration = Duration::from_secs(2);

fn client_builder(connect: Duration, answer: Duration) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(connect)
        .timeout(answer)
        // A redirect is an answer. Following it could fail somewhere else
        // (an identity provider, another host) and call this server down.
        .redirect(reqwest::redirect::Policy::none())
}

async fn probe(client: &reqwest::Client, url: &Url) -> Verdict {
    verdict(match client.get(url.clone()).send().await {
        Ok(_) => Probe::Answered,
        Err(e) => Probe::Failed {
            connect: e.is_connect(),
            dns: e.is_dns(),
            timeout: e.is_timeout(),
        },
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Checking,
    /// The server answered and the window is on its way there. Distinct
    /// from `Idle` so an offline page still showing in the meantime does
    /// not read it as "nothing is running" and start another attempt.
    Opening,
    /// The server did not answer and the window is loading its start page
    /// anyway, to see whether a Service Worker serves the cached app.
    TryingCachedUi,
    Unreachable {
        cause: Cause,
        retry_at: Instant,
    },
}

struct Inner {
    generation: u64,
    window: Option<String>,
    origin: Option<Url>,
    phase: Phase,
    /// The offline page was sent to the window by this attempt, so the
    /// window loading any other page means the person left it.
    shown: bool,
    /// The window shows a fully loaded offline page, so the server can be
    /// opened by `location.replace` and leave no history entry behind.
    page_ready: bool,
    /// While trying the cached app: the frontend committed, and finished.
    cached_committed: bool,
    cached_finished: bool,
}

/// What the offline page shows.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub origin: Option<String>,
    /// `idle`, `checking`, `opening` or `unreachable`.
    pub state: &'static str,
    pub cause: Option<Cause>,
    /// Seconds until the next automatic try, while unreachable.
    pub retry_in_secs: Option<u64>,
}

pub struct Connection {
    inner: Mutex<Inner>,
    /// Woken whenever the running attempt is superseded or stopped, so its
    /// task ends at once instead of at its next timer.
    cancel: Notify,
    /// Woken by the frontend's page-load events while the cached app is
    /// being tried.
    loaded: Notify,
}

impl Default for Connection {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                generation: 0,
                window: None,
                origin: None,
                phase: Phase::Idle,
                shown: false,
                page_ready: false,
                cached_committed: false,
                cached_finished: false,
            }),
            cancel: Notify::new(),
            loaded: Notify::new(),
        }
    }
}

impl Connection {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start a new attempt to open `origin` in window `label`, superseding
    /// any running one. Returns the attempt's generation.
    fn begin(&self, label: &str, origin: &Url) -> u64 {
        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            if inner.window.as_deref() != Some(label) {
                inner.page_ready = false;
            }
            inner.window = Some(label.to_string());
            inner.origin = Some(origin.clone());
            inner.phase = Phase::Checking;
            // A window already on the offline page (Try again) keeps it.
            inner.shown = inner.page_ready;
            inner.generation
        };
        self.cancel.notify_waiters();
        generation
    }

    /// Stop the running attempt, if any.
    pub fn stop(&self) {
        {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.phase = Phase::Idle;
            inner.shown = false;
        }
        self.cancel.notify_waiters();
    }

    /// A page committed in window `label` (`PageLoadEvent::Started`).
    pub fn page_started(&self, label: &str, on_frontend: bool) {
        let mut inner = self.lock();
        if inner.window.as_deref() == Some(label)
            && on_frontend
            && inner.phase == Phase::TryingCachedUi
        {
            inner.cached_committed = true;
            drop(inner);
            self.loaded.notify_waiters();
        }
    }

    /// A page finished loading in window `label`. Anything but the offline
    /// page, after this attempt sent the window there, means the person went
    /// elsewhere (Change server…, Back): stop probing for them.
    pub fn page_loaded(&self, label: &str, offline_page: bool, on_frontend: bool) {
        let (leave, cached) = {
            let mut inner = self.lock();
            if inner.window.as_deref() != Some(label) {
                return;
            }
            inner.page_ready = offline_page;
            if !offline_page && inner.phase == Phase::Opening {
                // Arrived. An offline page reached later (Back) starts over.
                inner.phase = Phase::Idle;
            }
            let cached = on_frontend && inner.phase == Phase::TryingCachedUi;
            if cached {
                // A finish implies a commit, whether or not one was reported.
                inner.cached_committed = true;
                inner.cached_finished = true;
            }
            (!offline_page && inner.shown, cached)
        };
        if cached {
            self.loaded.notify_waiters();
        }
        if leave {
            self.stop();
        }
    }

    pub fn window_closed(&self, label: &str) {
        let ours = {
            let mut inner = self.lock();
            let ours = inner.window.as_deref() == Some(label);
            if ours {
                inner.window = None;
                inner.page_ready = false;
            }
            ours
        };
        if ours {
            self.stop();
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.lock().generation == generation
    }

    fn set_phase(&self, generation: u64, phase: Phase) -> bool {
        let mut inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        inner.phase = phase;
        true
    }

    /// Record that this attempt sent the window to the offline page.
    /// Returns whether it was there already.
    fn mark_shown(&self, generation: u64) -> bool {
        let mut inner = self.lock();
        let already = inner.shown;
        if inner.generation == generation {
            inner.shown = true;
        }
        already
    }

    /// The server answered: end the attempt. Returns whether the window
    /// shows a loaded offline page, or `None` if the attempt was superseded.
    fn finish(&self, generation: u64) -> Option<bool> {
        let mut inner = self.lock();
        if inner.generation != generation {
            return None;
        }
        inner.phase = Phase::Opening;
        inner.shown = false;
        Some(inner.page_ready)
    }

    /// Whether this attempt began with the window on the offline page.
    fn began_on_offline_page(&self, generation: u64) -> bool {
        let inner = self.lock();
        inner.generation == generation && inner.shown
    }

    /// Start loading the start page to try the cached app. Like `finish`,
    /// returns whether a loaded offline page is showing, or `None` if the
    /// attempt was superseded. The window leaves the offline page on
    /// purpose here, so that is not taken as the person leaving it.
    fn try_cached_ui(&self, generation: u64) -> Option<bool> {
        let mut inner = self.lock();
        if inner.generation != generation {
            return None;
        }
        inner.phase = Phase::TryingCachedUi;
        inner.shown = false;
        inner.cached_committed = false;
        inner.cached_finished = false;
        Some(inner.page_ready)
    }

    /// Wait until `reached` holds for the cached-app flags, for at most
    /// `limit`. `Some(true)` when it does, `Some(false)` on timeout, `None`
    /// when the attempt was superseded or stopped.
    async fn wait_cached(
        &self,
        generation: u64,
        limit: Duration,
        reached: fn(&Inner) -> bool,
    ) -> Option<bool> {
        let deadline = Instant::now() + limit;
        loop {
            let cancelled = self.cancel.notified();
            let loaded = self.loaded.notified();
            {
                let inner = self.lock();
                if inner.generation != generation {
                    return None;
                }
                if reached(&inner) {
                    return Some(true);
                }
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Some(false);
            }
            // Woken by a page-load event or the deadline: look again either way.
            let _loaded_or_elapsed =
                unless_cancelled(tokio::time::timeout(left, loaded), cancelled).await?;
        }
    }

    /// The cached app booted: end the attempt and leave the window to it.
    fn leave_to_cached_ui(&self, generation: u64) -> bool {
        self.set_phase(generation, Phase::Idle)
    }

    pub fn status(&self) -> Status {
        self.status_at(Instant::now())
    }

    fn status_at(&self, now: Instant) -> Status {
        let inner = self.lock();
        let origin = inner.origin.as_ref().map(server::origin_string);
        match inner.phase {
            Phase::Idle => Status {
                origin,
                state: "idle",
                cause: None,
                retry_in_secs: None,
            },
            Phase::Checking | Phase::TryingCachedUi => Status {
                origin,
                state: "checking",
                cause: None,
                retry_in_secs: None,
            },
            Phase::Opening => Status {
                origin,
                state: "opening",
                cause: None,
                retry_in_secs: None,
            },
            Phase::Unreachable { cause, retry_at } => {
                let left = retry_at.saturating_duration_since(now);
                Status {
                    origin,
                    state: "unreachable",
                    cause: Some(cause),
                    // Rounded up, so the countdown never shows 0 while waiting.
                    retry_in_secs: Some(left.as_millis().div_ceil(1000) as u64),
                }
            }
        }
    }
}

/// `fut`, unless the attempt is cancelled first (`None`).
async fn unless_cancelled<F: Future>(
    fut: F,
    cancelled: tokio::sync::futures::Notified<'_>,
) -> Option<F::Output> {
    let mut fut = pin!(fut);
    let mut cancelled = pin!(cancelled);
    poll_fn(|cx| {
        if cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        fut.as_mut().poll(cx).map(Some)
    })
    .await
}

/// Open `origin` in window `label` once it answers, showing the offline
/// page while it does not. Creates the window when there is none yet (at
/// launch), so a reachable server is its first page and no blank or bundled
/// page sits under it in the history. Every path that sends a window to a
/// server's start page goes through here. Never blocks.
pub fn open<R: Runtime>(app: &AppHandle<R>, label: &str, origin: Url) {
    let generation = app.state::<AppState>().connection.begin(label, &origin);
    dlog!("opening {} once it answers", server::origin_string(&origin));
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        run(&app, &label, &origin, generation).await;
    });
}

async fn run<R: Runtime>(app: &AppHandle<R>, label: &str, origin: &Url, generation: u64) {
    let state = app.state::<AppState>();
    let connection = &state.connection;
    let start = server::start_url(origin);
    // The window may be created by this attempt (launch); once it exists,
    // its disappearing means it was closed.
    let mut may_create = app.get_webview_window(label).is_none();
    let client = match client_builder(CONNECT_TIMEOUT, ANSWER_TIMEOUT).build() {
        Ok(client) => client,
        Err(e) => {
            // Without a client there is no way to ask; load it as before.
            dlog!("no HTTP client for the reachability probe ({e}); loading directly");
            if connection.finish(generation).is_some() {
                show(app, label, Page::Server(&start), may_create, false);
            }
            return;
        }
    };
    let began_on_offline_page = connection.began_on_offline_page(generation);
    let mut attempt = 0u32;
    loop {
        // Created before the check, so a stop in between still wakes them.
        let cancelled = connection.cancel.notified();
        let cancelled_early = connection.cancel.notified();
        if !connection.is_current(generation) {
            return;
        }
        let mut pending = pin!(probe(&client, &start));
        let verdict = if attempt == 0 {
            // A slow first probe gets the page in its "Connecting…" state,
            // so the window does not sit blank (or on the picker) meanwhile.
            match unless_cancelled(
                tokio::time::timeout(SHOW_CHECKING_AFTER, &mut pending),
                cancelled_early,
            )
            .await
            {
                None => return,
                Some(Ok(verdict)) => verdict,
                Some(Err(_)) => {
                    // No window to show it in: closed (which already
                    // stopped this attempt) or never built.
                    if !connection.mark_shown(generation)
                        && !show(app, label, Page::Offline, may_create, false)
                    {
                        return;
                    }
                    may_create = false;
                    match unless_cancelled(pending, cancelled).await {
                        Some(verdict) => verdict,
                        None => return,
                    }
                }
            }
        } else {
            match unless_cancelled(pending, cancelled).await {
                Some(verdict) => verdict,
                None => return,
            }
        };
        dlog!("probe of {} -> {verdict:?}", log_url(&start));

        let next = after_probe(verdict, attempt, began_on_offline_page);
        match verdict {
            Verdict::Reachable => {
                if let Some(page_ready) = connection.finish(generation) {
                    show(app, label, Page::Server(&start), may_create, page_ready);
                }
                return;
            }
            Verdict::Unreachable(cause) => {
                if next == Next::TryCachedUi {
                    match try_cached_ui(app, label, connection, generation, &start, may_create)
                        .await
                    {
                        None => return,
                        Some(Next::LeaveToCachedUi) => {
                            connection.leave_to_cached_ui(generation);
                            return;
                        }
                        // Not booted: back to the offline page below.
                        Some(_) => may_create = false,
                    }
                }
                let delay = retry_delay(attempt);
                attempt = attempt.saturating_add(1);
                let phase = Phase::Unreachable {
                    cause,
                    retry_at: Instant::now() + delay,
                };
                let cancelled = connection.cancel.notified();
                if !connection.set_phase(generation, phase) {
                    return;
                }
                if !connection.mark_shown(generation) {
                    if !show(app, label, Page::Offline, may_create, false) {
                        return;
                    }
                    may_create = false;
                }
                if unless_cancelled(tokio::time::sleep(delay), cancelled)
                    .await
                    .is_none()
                {
                    return;
                }
                if !connection.set_phase(generation, Phase::Checking) {
                    return;
                }
            }
        }
    }
}

/// Load the start page although the server did not answer, and see whether
/// a Service Worker boots the cached app from it (design §10). `None` when
/// the attempt was superseded or the window is gone.
async fn try_cached_ui<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    connection: &Connection,
    generation: u64,
    start: &Url,
    may_create: bool,
) -> Option<Next> {
    let page_ready = connection.try_cached_ui(generation)?;
    if !show(app, label, Page::Server(start), may_create, page_ready) {
        return None;
    }
    let committed = connection
        .wait_cached(generation, CACHED_UI_COMMIT_WAIT, |i| i.cached_committed)
        .await?;
    let cached = if committed {
        // Asked once it has finished, or after the wait regardless: a
        // controlled document knows its worker from the moment it commits.
        connection
            .wait_cached(generation, CACHED_UI_FINISH_WAIT, |i| i.cached_finished)
            .await?;
        let window = app.get_webview_window(label)?;
        CachedUi::Committed {
            controlled: is_controlled(&window).await,
        }
    } else {
        CachedUi::NotCommitted
    };
    dlog!("cached app tried -> {cached:?}");
    Some(after_cached_try(cached))
}

/// Whether the window's document is controlled by a Service Worker.
async fn is_controlled<R: Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    // The callback is `Fn`, so the one-shot sender is taken out of a slot.
    let tx = Mutex::new(Some(tx));
    let asked = window.eval_with_callback(CONTROLLER_CHECK, move |result| {
        if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(result);
        }
    });
    if asked.is_err() {
        return false;
    }
    matches!(
        tokio::time::timeout(CONTROLLER_CHECK_WAIT, rx).await,
        Ok(Ok(result)) if controller_answer(&result)
    )
}

enum Page<'a> {
    Offline,
    Server(&'a Url),
}

/// Send window `label` to `page`. `create` allows building the window when
/// it does not exist yet (launch); otherwise a missing window was closed
/// meanwhile. `replace` opens the server by `location.replace`, for a window
/// showing a loaded offline page, so the page is not left in the history.
/// Returns `false` if there is no window to show it in.
fn show<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    page: Page<'_>,
    create: bool,
    replace: bool,
) -> bool {
    match app.get_webview_window(label) {
        Some(window) => {
            let result = match page {
                Page::Offline => window.navigate(bundled_url(OFFLINE_PAGE)),
                Page::Server(url) if replace => {
                    let target = serde_json::to_string(url.as_str())
                        .expect("a URL serializes to a JSON string");
                    window.eval(format!("location.replace({target})"))
                }
                Page::Server(url) => window.navigate(url.clone()),
            };
            if let Err(e) = result {
                dlog!("could not send the window on: {e}");
            }
            true
        }
        None if create => {
            let url = match page {
                Page::Offline => WebviewUrl::App(OFFLINE_PAGE.into()),
                Page::Server(url) => WebviewUrl::External(url.clone()),
            };
            match crate::build_window(app, label, url) {
                Ok(_) => true,
                Err(e) => {
                    eprintln!("[wafflebase-desktop] could not open the window: {e}");
                    false
                }
            }
        }
        // Closed while the probe ran.
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_back_off_from_two_to_thirty_seconds() {
        let secs: Vec<u64> = (0..7).map(|a| retry_delay(a).as_secs()).collect();
        assert_eq!(secs, [2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(retry_delay(31), LONGEST_RETRY);
        assert_eq!(retry_delay(u32::MAX), LONGEST_RETRY);
    }

    fn failed(connect: bool, dns: bool, timeout: bool) -> Verdict {
        verdict(Probe::Failed {
            connect,
            dns,
            timeout,
        })
    }

    #[test]
    fn any_answer_is_reachable() {
        assert_eq!(verdict(Probe::Answered), Verdict::Reachable);
    }

    #[test]
    fn only_connection_failures_are_unreachable() {
        assert_eq!(failed(true, true, false), Verdict::Unreachable(Cause::Dns));
        assert_eq!(
            failed(true, false, false),
            Verdict::Unreachable(Cause::Connect)
        );
        assert_eq!(
            failed(true, false, true),
            Verdict::Unreachable(Cause::Timeout)
        );
        // Connected, then slow to answer: up, let the webview wait.
        assert_eq!(failed(false, false, true), Verdict::Reachable);
        // Connected, then closed without answering.
        assert_eq!(
            failed(false, false, false),
            Verdict::Unreachable(Cause::Closed)
        );
    }

    #[test]
    fn an_unreachable_server_gets_one_chance_at_its_cached_app() {
        let down = Verdict::Unreachable(Cause::Dns);
        assert_eq!(after_probe(Verdict::Reachable, 0, false), Next::Open);
        assert_eq!(after_probe(Verdict::Reachable, 3, true), Next::Open);
        assert_eq!(after_probe(down, 0, false), Next::TryCachedUi);
        // Backoff probes, and Try again from the offline page, do not reload
        // a start page that already failed to boot.
        assert_eq!(after_probe(down, 1, false), Next::ShowOffline);
        assert_eq!(after_probe(down, 0, true), Next::ShowOffline);
    }

    #[test]
    fn only_a_controlled_document_counts_as_the_cached_app() {
        assert_eq!(
            after_cached_try(CachedUi::Committed { controlled: true }),
            Next::LeaveToCachedUi
        );
        // WebView2's error page commits under the frontend's URL.
        assert_eq!(
            after_cached_try(CachedUi::Committed { controlled: false }),
            Next::ShowOffline
        );
        // macOS without a worker: no page-load event at all.
        assert_eq!(after_cached_try(CachedUi::NotCommitted), Next::ShowOffline);
        assert!(controller_answer("true"));
        assert!(controller_answer(" true\n"));
        for no in ["false", "null", "", "\"true\"", "undefined"] {
            assert!(!controller_answer(no), "{no}");
        }
    }

    #[test]
    fn trying_the_cached_app_tracks_the_frontend_load() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        // The "Connecting…" page was up when the probe failed.
        c.mark_shown(generation);
        c.page_loaded("main", true, false);
        assert_eq!(c.try_cached_ui(generation), Some(true));
        assert_eq!(c.status().state, "checking");
        // Other windows and other origins do not count.
        c.page_started("window-1", true);
        c.page_started("main", false);
        assert!(!c.lock().cached_committed);
        c.page_started("main", true);
        assert!(c.lock().cached_committed);
        assert!(!c.lock().cached_finished);
        // Leaving the offline page for the start page is not leaving it.
        c.page_loaded("main", false, true);
        assert!(c.is_current(generation));
        assert!(c.lock().cached_finished);
        assert!(c.leave_to_cached_ui(generation));
        assert_eq!(c.status().state, "idle");
    }

    #[test]
    fn waiting_on_the_cached_app_ends_on_load_timeout_or_cancel() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        c.try_cached_ui(generation);
        let committed = |i: &Inner| i.cached_committed;
        let wait =
            |limit| tauri::async_runtime::block_on(c.wait_cached(generation, limit, committed));
        assert_eq!(wait(Duration::from_millis(50)), Some(false));
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                c.page_started("main", true);
            });
            let started = Instant::now();
            assert_eq!(wait(Duration::from_secs(5)), Some(true));
            assert!(started.elapsed() < Duration::from_secs(4));
        });
        c.stop();
        assert_eq!(wait(Duration::from_secs(5)), None);
    }

    #[test]
    fn recognizes_the_offline_page() {
        assert!(is_offline_page(&bundled_url(OFFLINE_PAGE)));
        assert!(!is_offline_page(&bundled_url("index.html")));
        assert!(!is_offline_page(
            &Url::parse("https://wafflebase.io/offline.html").unwrap()
        ));
    }

    fn origin() -> Url {
        Url::parse("https://wafflebase.example.com").unwrap()
    }

    #[test]
    fn a_new_attempt_supersedes_the_running_one() {
        let c = Connection::default();
        let first = c.begin("main", &origin());
        let second = c.begin("main", &origin());
        assert!(!c.is_current(first));
        assert!(c.is_current(second));
        assert!(!c.set_phase(first, Phase::Idle));
        assert_eq!(c.finish(first), None);
        c.stop();
        assert!(!c.is_current(second));
        assert_eq!(c.status().state, "idle");
    }

    #[test]
    fn leaving_the_offline_page_stops_probing() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        // Before the page was sent, other loads (the picker) are not leaving.
        c.page_loaded("main", false, true);
        assert!(c.is_current(generation));
        assert!(!c.mark_shown(generation));
        c.page_loaded("main", true, false);
        // Another window's load is not this one's.
        c.page_loaded("window-1", false, true);
        assert!(c.is_current(generation));
        c.page_loaded("main", false, true);
        assert!(!c.is_current(generation));
    }

    #[test]
    fn try_again_keeps_the_page_it_is_on() {
        let c = Connection::default();
        let first = c.begin("main", &origin());
        c.mark_shown(first);
        c.page_loaded("main", true, false);
        let second = c.begin("main", &origin());
        assert!(c.mark_shown(second), "already on the offline page");
        assert_eq!(c.finish(second), Some(true));
        // A new attempt in another window does not inherit the page.
        let third = c.begin("window-1", &origin());
        assert!(!c.mark_shown(third));
    }

    #[test]
    fn an_answer_reads_as_opening_until_the_server_loads() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        c.mark_shown(generation);
        c.page_loaded("main", true, false);
        assert_eq!(c.finish(generation), Some(true));
        // The offline page, still showing, must not start another attempt.
        assert_eq!(c.status().state, "opening");
        c.page_loaded("main", false, true);
        assert_eq!(c.status().state, "idle");
    }

    #[test]
    fn closing_the_window_stops_probing() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        c.window_closed("window-1");
        assert!(c.is_current(generation));
        c.window_closed("main");
        assert!(!c.is_current(generation));
    }

    #[test]
    fn status_counts_down_to_the_next_try() {
        let c = Connection::default();
        let generation = c.begin("main", &origin());
        let status = c.status();
        assert_eq!(status.state, "checking");
        assert_eq!(
            status.origin.as_deref(),
            Some("https://wafflebase.example.com")
        );
        let now = Instant::now();
        assert!(c.set_phase(
            generation,
            Phase::Unreachable {
                cause: Cause::Dns,
                retry_at: now + Duration::from_millis(3200),
            },
        ));
        let status = c.status_at(now);
        assert_eq!(status.state, "unreachable");
        assert_eq!(status.cause, Some(Cause::Dns));
        assert_eq!(status.retry_in_secs, Some(4));
        assert_eq!(
            c.status_at(now + Duration::from_secs(10)).retry_in_secs,
            Some(0)
        );
        assert_eq!(
            serde_json::to_value(c.status_at(now)).unwrap(),
            serde_json::json!({
                "origin": "https://wafflebase.example.com",
                "state": "unreachable",
                "cause": "dns",
                "retryInSecs": 4,
            })
        );
    }

    fn test_client(answer: Duration) -> reqwest::Client {
        // No proxy: a proxy set in the environment would answer for these
        // loopback addresses itself.
        client_builder(Duration::from_secs(5), answer)
            .no_proxy()
            .build()
            .unwrap()
    }

    fn run_probe(url: &str, answer: Duration) -> Verdict {
        let url = Url::parse(url).unwrap();
        tauri::async_runtime::block_on(async move { probe(&test_client(answer), &url).await })
    }

    /// A server that answers every request with `status` and `headers`.
    fn answering(status: u16, headers: &[(&str, &str)]) -> (String, std::thread::JoinHandle<()>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let headers: Vec<tiny_http::Header> = headers
            .iter()
            .map(|(k, v)| tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap())
            .collect();
        let handle = std::thread::spawn(move || {
            if let Ok(Some(request)) = server.recv_timeout(Duration::from_secs(5)) {
                let mut response = tiny_http::Response::empty(status);
                for h in headers {
                    response.add_header(h);
                }
                let _ = request.respond(response);
            }
        });
        (format!("http://127.0.0.1:{port}/login"), handle)
    }

    #[test]
    fn an_error_status_is_still_an_answer() {
        let (url, handle) = answering(503, &[]);
        assert_eq!(run_probe(&url, Duration::from_secs(5)), Verdict::Reachable);
        handle.join().unwrap();
    }

    #[test]
    fn a_redirect_is_an_answer_and_is_not_followed() {
        // Following it would hit a port nobody listens on.
        let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let target = format!("http://127.0.0.1:{}/", dead.local_addr().unwrap().port());
        drop(dead);
        let (url, handle) = answering(302, &[("Location", &target)]);
        assert_eq!(run_probe(&url, Duration::from_secs(5)), Verdict::Reachable);
        handle.join().unwrap();
    }

    #[test]
    fn a_refused_connection_is_unreachable() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(
            run_probe(
                &format!("http://127.0.0.1:{port}/login"),
                Duration::from_secs(5)
            ),
            Verdict::Unreachable(Cause::Connect)
        );
    }

    #[test]
    fn a_slow_answer_is_reachable() {
        // The kernel completes the handshake from the backlog; nothing ever
        // answers.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(
            run_probe(
                &format!("http://127.0.0.1:{port}/login"),
                Duration::from_millis(300)
            ),
            Verdict::Reachable
        );
        drop(listener);
    }

    #[test]
    fn cancelling_ends_a_wait_at_once() {
        let c = Connection::default();
        tauri::async_runtime::block_on(async {
            let cancelled = c.cancel.notified();
            c.stop();
            let started = Instant::now();
            let waited =
                unless_cancelled(tokio::time::sleep(Duration::from_secs(30)), cancelled).await;
            assert!(waited.is_none());
            assert!(started.elapsed() < Duration::from_secs(5));
        });
    }
}
