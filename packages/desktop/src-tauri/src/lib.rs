//! Wafflebase desktop shell: a Tauri 2 window onto a team's own Wafflebase
//! deployment. See `docs/design/desktop-app.md`.
//!
//! The deployment's frontend is loaded from its own origin and gets no IPC
//! (capabilities grant commands only to the bundled pages in `../src`).
//! Everything the desktop does for it is driven from the navigation,
//! new-window and download hooks below.

mod login;
mod navigation;
mod server;
mod signin;
mod update;

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use navigation::{Context, Decision, Request};
use server::ServerStore;

/// One line per event on stderr, in debug builds only. Never pass secrets
/// (nonce, verifier, code, launch token) to it.
#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[wafflebase-desktop] {}", format!($($arg)*));
        }
    };
}

const MAIN_WINDOW: &str = "main";
const CHANGE_SERVER_ID: &str = "change-server";
const CHECK_UPDATES_ID: &str = "check-updates";
const BACK_ID: &str = "nav-back";
const FORWARD_ID: &str = "nav-forward";
const RELOAD_ID: &str = "nav-reload";

/// Development override for the saved server.
const SERVER_ENV: &str = "WAFFLEBASE_DESKTOP_SERVER";

pub struct AppState {
    store: ServerStore,
    frontend: RwLock<Option<Url>>,
    signin: signin::SignIn,
    window_seq: AtomicU32,
    #[cfg(debug_assertions)]
    smoke_signin_started: std::sync::atomic::AtomicBool,
}

impl AppState {
    fn frontend(&self) -> Option<Url> {
        self.frontend
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn set_frontend(&self, url: Option<Url>) {
        *self.frontend.write().unwrap_or_else(|e| e.into_inner()) = url;
    }
}

/// A bundled page's URL: `tauri://localhost/<path>` on macOS and Linux,
/// `http://tauri.localhost/<path>` on Windows.
pub(crate) fn bundled_url(path: &str) -> Url {
    let base = if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(base)
        .and_then(|b| b.join(path))
        .expect("bundled page URL is valid")
}

/// A URL with its query and fragment dropped, for debug logs.
fn log_url(url: &Url) -> String {
    match url.host_str() {
        Some(host) => match url.port() {
            Some(port) => format!("{}://{host}:{port}{}", url.scheme(), url.path()),
            None => format!("{}://{host}{}", url.scheme(), url.path()),
        },
        None => format!("{}:", url.scheme()),
    }
}

/// Decide for a request from window `label`, whose current page is
/// `current` when the caller knows it.
fn decide<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: &Url,
    request: Request,
    current: Option<&Url>,
) -> Decision {
    let state = app.state::<AppState>();
    let frontend = state.frontend();
    let session_post = state.signin.session_post_for(label);
    navigation::decide(
        url,
        request,
        Context {
            frontend: frontend.as_ref(),
            current,
            session_post: session_post.as_ref(),
        },
    )
}

/// A same-window navigation to a web sign-in link. Whether to take it over
/// depends on the page the window shows now (the frontend's `/login` only),
/// and the frontend reaches `/login` by client-side routing, which fires no
/// page-load event, so the window's URL is read here, after the navigation
/// was cancelled. Reading it inside the navigation callback would wait on the
/// main thread that is running the callback.
fn decide_sign_in_link<R: Runtime>(app: &AppHandle<R>, label: &str, target: Url) {
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let current = app
            .get_webview_window(&label)
            .and_then(|window| window.url().ok());
        let decision = decide(&app, &label, &target, Request::Navigate, current.as_ref());
        dlog!(
            "sign-in link {} from {} -> {:?}",
            log_url(&target),
            current
                .as_ref()
                .map(log_url)
                .unwrap_or_else(|| "unknown".into()),
            decision
        );
        match decision {
            Decision::StartSignIn { backend, return_to } => {
                signin::start(&app, &label, backend, return_to)
            }
            Decision::OpenExternal => open_external(&app, &target),
            // A web sign-in link is always one of the two above.
            _ => {}
        }
    });
}

fn open_external<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
        dlog!("could not open {} externally: {e}", log_url(url));
    }
}

/// Build an app window with the navigation, new-window and download policy
/// attached. Every window, the first and the ones `window.open` asks for,
/// goes through here.
fn build_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: WebviewUrl,
) -> tauri::Result<WebviewWindow<R>> {
    let nav_app = app.clone();
    let nav_label = label.to_string();
    let new_app = app.clone();
    let new_label = label.to_string();
    let dl_app = app.clone();

    WebviewWindowBuilder::new(app, label, url)
        .title("Wafflebase")
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&window_title(&title));
        })
        .inner_size(1280.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .on_navigation(move |url| {
            if navigation::is_web_github_sign_in(url) {
                decide_sign_in_link(&nav_app, &nav_label, url.clone());
                return false;
            }
            let decision = decide(&nav_app, &nav_label, url, Request::Navigate, None);
            dlog!("navigation {} -> {:?}", log_url(url), decision);
            match decision {
                Decision::Allow => true,
                Decision::AllowSessionPost => {
                    // One-shot: the first navigation consumes it.
                    let allowed = nav_app
                        .state::<AppState>()
                        .signin
                        .take_session_post(&nav_label, url);
                    dlog!("session POST allowance consumed: {allowed}");
                    allowed
                }
                Decision::OpenExternal => {
                    // The session POST's redirect, sent somewhere other than
                    // the chosen server: report it in the window rather than
                    // open the frontend's sign-in result in the browser.
                    if nav_app
                        .state::<AppState>()
                        .signin
                        .redirected_away_after_post(&nav_label)
                    {
                        dlog!("session POST redirected off the frontend; sign-in failed");
                        if let Some(window) = nav_app.get_webview_window(&nav_label) {
                            let _ = window.navigate(bundled_url("signin.html"));
                        }
                        return false;
                    }
                    open_external(&nav_app, url);
                    false
                }
                // Web sign-in links were diverted above, and `decide` with no
                // current page never takes one over.
                Decision::StartSignIn { .. } | Decision::OpenAppWindow | Decision::Deny => false,
            }
        })
        .on_new_window(move |url, _features| {
            let decision = decide(&new_app, &new_label, &url, Request::NewWindow, None);
            dlog!("new window {} -> {:?}", log_url(&url), decision);
            match decision {
                Decision::OpenAppWindow => {
                    // Built off this callback: creating a window from inside a
                    // webview delegate call deadlocks on Windows.
                    let app = new_app.clone();
                    tauri::async_runtime::spawn(async move {
                        let seq = app
                            .state::<AppState>()
                            .window_seq
                            .fetch_add(1, Ordering::SeqCst);
                        let label = format!("window-{seq}");
                        if let Err(e) = build_window(&app, &label, WebviewUrl::External(url)) {
                            dlog!("could not open a new window: {e}");
                        }
                    });
                }
                Decision::OpenExternal => open_external(&new_app, &url),
                // A new window never starts sign-in or gets the session POST.
                Decision::StartSignIn { .. }
                | Decision::AllowSessionPost
                | Decision::Allow
                | Decision::Deny => {}
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let frontend = dl_app.state::<AppState>().frontend();
                    if !navigation::download_allowed(&url, frontend.as_ref()) {
                        dlog!("download {} refused: not from the frontend", log_url(&url));
                        return false;
                    }
                    let suggested = destination
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    match dl_app.path().download_dir() {
                        Ok(dir) => {
                            *destination = navigation::download_destination(&dir, &suggested);
                            dlog!("download {} -> {}", log_url(&url), destination.display());
                        }
                        Err(e) => {
                            dlog!("no Downloads folder ({e}); refusing the download");
                            return false;
                        }
                    }
                }
                DownloadEvent::Finished { success, .. } => {
                    dlog!("download finished, success: {success}");
                }
                _ => {}
            }
            true
        })
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            dlog!("page loaded {}", log_url(payload.url()));
            let state = window.state::<AppState>();
            let on_frontend = state
                .frontend()
                .is_some_and(|f| f.origin() == payload.url().origin());
            let bundled = navigation::is_bundled(payload.url());
            if state
                .signin
                .page_loaded(window.label(), on_frontend, bundled)
                == signin::PageCheck::Unexpected
            {
                dlog!("sign-in window loaded an unexpected page; showing the error");
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = window.navigate(bundled_url("signin.html"));
                });
            }
            #[cfg(debug_assertions)]
            smoke_signin(&window, payload.url());
        })
        .build()
}

/// Debug-build smoke hook: with `WAFFLEBASE_DESKTOP_SMOKE_SIGNIN=<backend>`,
/// the first time the main window finishes loading the server's frontend,
/// start sign-in against that backend exactly as an intercepted
/// `/auth/github` navigation would.
#[cfg(debug_assertions)]
fn smoke_signin<R: Runtime>(window: &WebviewWindow<R>, url: &Url) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    let Some(raw) = std::env::var_os("WAFFLEBASE_DESKTOP_SMOKE_SIGNIN") else {
        return;
    };
    let app = window.app_handle();
    let state = app.state::<AppState>();
    let on_frontend = state.frontend().is_some_and(|f| f.origin() == url.origin());
    if !on_frontend || state.smoke_signin_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let raw = raw.to_string_lossy();
    if let Some(backend) = raw.strip_prefix("click:") {
        // Exercise the real intercept: sign out if a session survived from
        // an earlier run, then click the login page's own GitHub link, so
        // the navigation goes through the same-window `/login` rule. The
        // sign-out lands on `/login?returnTo=/templates`, so a run that
        // ends on `/templates` has carried `returnTo` through. Re-armed on every frontend load; `sessionStorage` keeps the
        // script from signing out again or clicking twice.
        state.smoke_signin_started.store(false, Ordering::SeqCst);
        let script = format!(
            r#"(function () {{
  if (sessionStorage.getItem('wbSmokeClicked')) return;
  var started = Date.now();
  var timer = setInterval(function () {{
    var link = document.querySelector('a[href*="/auth/github"]');
    if (link && location.pathname === '/login') {{
      clearInterval(timer);
      sessionStorage.setItem('wbSmokeClicked', '1');
      link.click();
    }} else if (Date.now() - started > 3000 && !sessionStorage.getItem('wbSmokeSignedOut')) {{
      clearInterval(timer);
      sessionStorage.setItem('wbSmokeSignedOut', '1');
      fetch({backend:?} + '/auth/logout', {{ method: 'POST', credentials: 'include' }})
        .finally(function () {{ location.href = '/login?returnTo=%2Ftemplates'; }});
    }} else if (Date.now() - started > 15000) {{
      clearInterval(timer);
    }}
  }}, 200);
}})();"#
        );
        dlog!("smoke: clicking the login page's GitHub link");
        let _ = window.eval(&script);
        return;
    }
    match Url::parse(&raw)
        .ok()
        .filter(|u| matches!(u.scheme(), "http" | "https"))
    {
        Some(backend) => {
            let backend = Url::parse(&backend.origin().ascii_serialization())
                .expect("origin serializes to a URL");
            dlog!(
                "smoke: starting sign-in against {}",
                server::origin_string(&backend)
            );
            signin::start(app, MAIN_WINDOW, backend, None);
        }
        None => dlog!("smoke: WAFFLEBASE_DESKTOP_SMOKE_SIGNIN is not an http(s) URL"),
    }
}

/// Window `label`, or else the main window, or else any open one: the main
/// window can be closed while windows opened from it stay.
pub(crate) fn window_or_any<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Option<WebviewWindow<R>> {
    app.get_webview_window(label)
        .or_else(|| app.get_webview_window(MAIN_WINDOW))
        .or_else(|| {
            let mut windows: Vec<_> = app.webview_windows().into_iter().collect();
            windows.sort_by(|a, b| a.0.cmp(&b.0));
            windows.into_iter().next().map(|(_, w)| w)
        })
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = window_or_any(app, MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The default app menu (with its Edit menu, which macOS needs for
/// Cmd+C/V/X/Z/A to reach the webview) plus "Check for Updates…" and
/// "Change server…".
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let updates = MenuItem::with_id(
        app,
        CHECK_UPDATES_ID,
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let change = MenuItem::with_id(app, CHANGE_SERVER_ID, "Change server…", true, None::<&str>)?;
    let items = menu.items()?;
    // macOS: the first submenu is the app menu. Elsewhere: the File menu.
    let target = if cfg!(target_os = "macos") {
        items.first().and_then(MenuItemKind::as_submenu).cloned()
    } else {
        items
            .iter()
            .filter_map(MenuItemKind::as_submenu)
            .find(|s| s.text().is_ok_and(|t| t == "File"))
            .cloned()
    };
    match target {
        Some(submenu) => {
            // After "About" and its separator on macOS; first in File elsewhere.
            let at = if cfg!(target_os = "macos") { 2 } else { 0 };
            submenu.insert_items(&[&updates, &change], at)?;
        }
        None => {
            let file = Submenu::with_items(app, "File", true, &[&updates, &change])?;
            menu.prepend(&file)?;
        }
    }

    // The window has no toolbar, so a page the app has no way out of (a
    // template landing, an error) would otherwise be a dead end. Deliberately
    // without the browser's accelerators: a menu accelerator wins over the
    // page, and Cmd+[ / Cmd+] indent in Docs and Cmd+R fills right in Sheets
    // (Google parity, see the shortcut catalogs).
    let back = MenuItem::with_id(app, BACK_ID, "Back", true, None::<&str>)?;
    let forward = MenuItem::with_id(app, FORWARD_ID, "Forward", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, RELOAD_ID, "Reload", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let view = menu
        .items()?
        .iter()
        .filter_map(MenuItemKind::as_submenu)
        .find(|s| s.text().is_ok_and(|t| t == "View"))
        .cloned();
    match view {
        Some(view) => {
            let has_items = !view.items()?.is_empty();
            view.insert_items(&[&back, &forward, &reload], 0)?;
            if has_items {
                view.insert(&separator, 3)?;
            }
        }
        None => {
            let view = Submenu::with_items(app, "View", true, &[&back, &forward, &reload])?;
            // After File and Edit where they exist.
            let at = menu.items()?.len().min(2);
            menu.insert(&view, at)?;
        }
    }
    Ok(menu)
}

/// The window the user is looking at, for menu commands that act on a page.
fn focused_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| window_or_any(app, MAIN_WINDOW))
}

/// The native window title for a page title: the document's own name, so
/// windows opened side by side can be told apart in the Window menu, the
/// Dock and Alt+Tab.
fn window_title(page_title: &str) -> String {
    let title = page_title.trim();
    if title.is_empty() {
        "Wafflebase".to_string()
    } else {
        title.to_string()
    }
}

/// The server to open at launch: the environment override, then the saved
/// profile, then the official server. The picker is reached from the menu.
fn initial_server(store: &ServerStore) -> Url {
    if let Some(raw) = std::env::var_os(SERVER_ENV) {
        match server::parse_server_origin(&raw.to_string_lossy()) {
            Ok(url) => {
                dlog!("{SERVER_ENV} overrides the saved server");
                return url;
            }
            Err(e) => eprintln!("[wafflebase-desktop] ignoring {SERVER_ENV}: {e}"),
        }
    }
    store.load().unwrap_or_else(server::official_server)
}

// ---------------------------------------------------------------------------
// Commands, for the bundled pages only (see capabilities/local.json).

#[derive(Serialize)]
struct ServerInfo {
    origin: Option<String>,
    /// Where "Cancel" returns to: the server's sign-in page.
    start: Option<String>,
    official: bool,
}

#[tauri::command]
fn get_server(state: tauri::State<'_, AppState>) -> ServerInfo {
    dlog!("picker asked for the saved server");
    let frontend = state.frontend();
    ServerInfo {
        origin: frontend.as_ref().map(server::origin_string),
        start: frontend.as_ref().map(|u| server::start_url(u).to_string()),
        official: frontend.is_some_and(|u| u.origin() == server::official_server().origin()),
    }
}

/// Points this app at `origin` and opens it in `window`.
fn switch_server<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    state: &AppState,
    origin: Url,
) -> Result<String, String> {
    state.signin.cancel();
    state.set_frontend(Some(origin.clone()));
    // Other windows belong to the previous server.
    for (label, other) in app.webview_windows() {
        if label != window.label() {
            let _ = other.close();
        }
    }
    window
        .navigate(server::start_url(&origin))
        .map_err(|e| e.to_string())?;
    Ok(server::origin_string(&origin))
}

#[tauri::command]
fn set_server<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: String,
) -> Result<String, String> {
    let origin = server::parse_server_origin(&input).map_err(|e| e.to_string())?;
    state
        .store
        .save(&origin)
        .map_err(|e| format!("Could not save the server: {e}"))?;
    switch_server(&app, &window, &state, origin)
}

/// Forgets the saved server and opens the official one.
#[tauri::command]
fn use_official_server<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state
        .store
        .clear()
        .map_err(|e| format!("Could not reset the server: {e}"))?;
    switch_server(&app, &window, &state, server::official_server())
}

#[tauri::command]
fn login_status(state: tauri::State<'_, AppState>) -> signin::Status {
    state.signin.status()
}

#[tauri::command]
fn cancel_login<R: Runtime>(window: WebviewWindow<R>, state: tauri::State<'_, AppState>) {
    // Only this window's own attempt: a stale page here must not cancel one
    // running in another window.
    state.signin.cancel_in(window.label());
    let target = state
        .frontend()
        .map(|origin| server::start_url(&origin))
        .unwrap_or_else(|| bundled_url("index.html"));
    let _ = window.navigate(target);
}

#[tauri::command]
fn take_handoff<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
) -> Option<signin::Handoff> {
    let handoff = state.signin.take_handoff(window.label());
    dlog!(
        "handoff page loaded (material present: {})",
        handoff.is_some()
    );
    handoff
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over and exits before anything else.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Without its link script. That script catches every `target=_blank`
        // click, cancels it and asks over IPC to open the URL, but the
        // deployment's pages get no IPC on purpose (capabilities/local.json),
        // so the click died silently. With it off, WebKit hands the request
        // to `on_new_window`, and the navigation policy decides (§4).
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_server,
            set_server,
            use_official_server,
            login_status,
            cancel_login,
            take_handoff
        ])
        .menu(build_menu)
        .on_menu_event(|app, event| {
            let page_script = match event.id().as_ref() {
                BACK_ID => Some("history.back()"),
                FORWARD_ID => Some("history.forward()"),
                RELOAD_ID => Some("location.reload()"),
                _ => None,
            };
            if let Some(script) = page_script {
                if let Some(window) = focused_window(app) {
                    let _ = window.eval(script);
                }
            } else if event.id() == CHECK_UPDATES_ID {
                update::check_from_menu(app);
            } else if event.id() == CHANGE_SERVER_ID {
                app.state::<AppState>().signin.cancel();
                if let Some(window) = window_or_any(app, MAIN_WINDOW) {
                    let _ = window.navigate(bundled_url("index.html"));
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let store = ServerStore::new(&config_dir);
            let initial = initial_server(&store);
            app.manage(AppState {
                store,
                frontend: RwLock::new(Some(initial.clone())),
                signin: signin::SignIn::default(),
                window_seq: AtomicU32::new(1),
                #[cfg(debug_assertions)]
                smoke_signin_started: std::sync::atomic::AtomicBool::new(false),
            });
            build_window(
                app.handle(),
                MAIN_WINDOW,
                WebviewUrl::External(server::start_url(&initial)),
            )?;
            app.manage(update::Updates::default());
            update::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Wafflebase desktop app")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                update::install_pending_at_exit(app);
            }
        });
}

#[cfg(test)]
mod tests {
    /// The bundled pages hold IPC, so no other page may frame them.
    #[test]
    fn bundled_pages_cannot_be_framed() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        assert!(
            csp.split(';').any(|d| d.trim() == "frame-ancestors 'none'"),
            "{csp}"
        );
    }

    /// The update endpoint is compiled in, so a wrong one strands every
    /// install. The app ships in the same GitHub release as the server, so
    /// the repository's "Latest" release carries its `latest.json`; a
    /// prerelease is never "Latest" and so never offered.
    #[test]
    fn update_endpoint_is_the_latest_release() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        let endpoints = updater["endpoints"].as_array().unwrap();
        assert_eq!(endpoints.len(), 1, "{endpoints:?}");
        let endpoint = endpoints[0].as_str().unwrap();
        assert!(endpoint.starts_with("https://"), "{endpoint}");
        assert!(
            endpoint
                == "https://github.com/wafflebase/wafflebase/releases/latest/download/latest.json",
            "{endpoint}"
        );
        assert!(updater.get("dangerousInsecureTransportProtocol").is_none());
        assert!(!updater["pubkey"].as_str().unwrap().is_empty());
        // On in the release overlay only, so a local `tauri build` needs no
        // updater key; without it a release would have no `.sig` to ship.
        assert!(conf["bundle"].get("createUpdaterArtifacts").is_none());
        let release: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.release.conf.json")).unwrap();
        assert_eq!(release["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn window_title_follows_the_page() {
        assert_eq!(
            super::window_title("Q3 budget — Wafflebase"),
            "Q3 budget — Wafflebase"
        );
        assert_eq!(super::window_title("  "), "Wafflebase");
        assert_eq!(super::window_title(""), "Wafflebase");
    }

    /// The deployment's origin gets no capability.
    #[test]
    fn no_capability_is_granted_to_a_remote_origin() {
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/local.json")).unwrap();
        assert!(cap.get("remote").is_none(), "{cap}");
    }
}
