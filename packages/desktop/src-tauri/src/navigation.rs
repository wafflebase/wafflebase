//! Navigation, new-window and download policy.
//!
//! The deployment's frontend runs with no IPC, so everything the desktop needs
//! from it (intercepting sign-in, sending other sites to the system browser,
//! saving downloads) is decided here from the URLs the webview reports. The
//! decision is a pure function so it can be tested without a webview.
//!
//! On macOS (wry 0.57) the navigation hook receives only the URL: it runs for
//! subframe navigations as well as the top-level one, and cannot tell them
//! apart. The frontend's only iframes are same-origin (the home page demo), so
//! applying one policy to both is safe today.

use std::path::{Path, PathBuf};

use url::Url;

/// What kind of request the webview is asking about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    /// A navigation in an existing window (link, form, redirect, `location`).
    Navigate,
    /// `window.open` or `target=_blank`.
    NewWindow,
}

/// What to do with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Let the webview proceed.
    Allow,
    /// Let the webview proceed with the handoff page's one POST to
    /// `<backend>/auth/desktop/session`. The caller consumes the allowance.
    AllowSessionPost,
    /// Cancel, and run desktop sign-in against this backend origin.
    StartSignIn { backend: Url },
    /// Cancel, and open the URL in a new app window with the same policy.
    OpenAppWindow,
    /// Cancel, and hand the URL to the system browser.
    OpenExternal,
    /// Cancel and do nothing.
    Deny,
}

/// The state the decision depends on.
#[derive(Debug, Default, Clone, Copy)]
pub struct Context<'a> {
    /// The saved server's frontend origin, once one is chosen.
    pub frontend: Option<&'a Url>,
    /// The page the requesting window shows now. Sign-in is intercepted only
    /// from the frontend's own login page.
    pub current: Option<&'a Url>,
    /// The `<backend>/auth/desktop/session` URL this window's handoff page may
    /// POST to, once, while a sign-in has a code waiting to be redeemed. The
    /// caller passes it only for the window the sign-in runs in.
    pub session_post: Option<&'a Url>,
}

/// The origin bundled pages are served from on this platform.
const BUNDLED_ORIGIN: (&str, &str) = if cfg!(windows) {
    ("http", "tauri.localhost")
} else {
    ("tauri", "localhost")
};

/// Whether a URL is one of the app's bundled pages: exactly
/// `tauri://localhost` on macOS and Linux, `http://tauri.localhost` on
/// Windows (no port, no other scheme).
pub fn is_bundled(url: &Url) -> bool {
    is_bundled_on(url, BUNDLED_ORIGIN)
}

fn is_bundled_on(url: &Url, (scheme, host): (&str, &str)) -> bool {
    url.scheme() == scheme && url.host_str() == Some(host) && url.port().is_none()
}

/// A `<backend>/auth/github` with no `mode`: the web sign-in link the
/// frontend renders. A URL that already carries `mode` (`cli`, `desktop`) is
/// some other flow's and is left alone.
pub fn is_web_github_sign_in(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.path() == "/auth/github"
        && !url.query_pairs().any(|(key, _)| key == "mode")
}

/// Whether `url` is the frontend's login route, the only page whose sign-in
/// link the shell takes over.
fn is_frontend_login(url: &Url, frontend: &Url) -> bool {
    same_origin(url, frontend) && url.path() == "/login"
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.origin() == b.origin()
}

/// Decide what to do with a navigation or a new-window request.
pub fn decide(url: &Url, request: Request, ctx: Context<'_>) -> Decision {
    if is_bundled(url) {
        return match request {
            Request::Navigate => Decision::Allow,
            Request::NewWindow => Decision::Deny,
        };
    }

    let is_frontend = |u: &Url| ctx.frontend.is_some_and(|f| same_origin(u, f));
    match url.scheme() {
        "http" | "https" => {}
        // `about:blank`/`about:srcdoc` frames have no other place to go.
        "about" => {
            return match request {
                Request::Navigate => Decision::Allow,
                Request::NewWindow => Decision::Deny,
            };
        }
        // A `blob:` document the frontend made (a PDF preview, say). A blob
        // minted by any other origin is not the frontend's. A `blob:`
        // download is not a navigation: WebKit routes it to the download hook.
        "blob" => {
            return match request {
                Request::Navigate if is_frontend(url) => Decision::Allow,
                _ => Decision::Deny,
            };
        }
        // Links that name another app on purpose.
        "mailto" | "tel" => return Decision::OpenExternal,
        // `data:`, `file:`, custom schemes and anything else: a `data:`
        // document has an opaque origin and no address bar to show it, and
        // the rest would let a remote page launch handlers on this machine.
        _ => return Decision::Deny,
    }

    // The sign-in link is taken over only when the frontend's own login page
    // follows it in the same window. A link to `/auth/github` anywhere else
    // (a collaborator's hyperlink in a sheet, a new window) is somebody
    // else's sign-in page as far as the shell knows, so it goes to the system
    // browser, never in-window: OAuth in a window without an address bar is
    // what this design avoids.
    if is_web_github_sign_in(url) {
        let from_login = request == Request::Navigate
            && matches!((ctx.current, ctx.frontend), (Some(c), Some(f)) if is_frontend_login(c, f));
        if from_login {
            let backend = Url::parse(&url.origin().ascii_serialization())
                .expect("an http(s) origin serializes to a valid URL");
            return Decision::StartSignIn { backend };
        }
        return Decision::OpenExternal;
    }

    match request {
        Request::Navigate => {
            if is_frontend(url) {
                return Decision::Allow;
            }
            if let Some(target) = ctx.session_post {
                if same_origin(url, target) && url.path() == target.path() {
                    return Decision::AllowSessionPost;
                }
            }
            Decision::OpenExternal
        }
        Request::NewWindow => {
            if is_frontend(url) {
                Decision::OpenAppWindow
            } else {
                Decision::OpenExternal
            }
        }
    }
}

/// The last path component of a suggested download name, with anything that
/// could escape the Downloads folder removed.
pub fn sanitize_file_name(name: &str) -> String {
    let last = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .map(|c| if c.is_control() || c == ':' { '_' } else { c })
        .collect::<String>();
    let trimmed = last.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        last.trim().to_string()
    }
}

/// A file name in a folder that does not overwrite an existing file:
/// `report.xlsx`, then `report (1).xlsx`, `report (2).xlsx`, … The counter
/// goes before the last extension, as browsers do.
pub fn dedupe_file_name(name: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(name) {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !exists(candidate))
        .expect("an unbounded counter finds a free name")
}

/// Where a download lands: the Downloads folder, under the suggested name,
/// never overwriting a file already there.
pub fn download_destination(downloads: &Path, suggested: &str) -> PathBuf {
    let name = dedupe_file_name(&sanitize_file_name(suggested), |candidate| {
        downloads.join(candidate).exists()
    });
    downloads.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    const FRONTEND: &str = "https://app.example.com";

    /// A same-window navigation from a page on the frontend (not the login
    /// page) with no sign-in pending.
    fn nav(url: &str) -> Decision {
        let f = u(FRONTEND);
        let current = u("https://app.example.com/w/1");
        decide(
            &u(url),
            Request::Navigate,
            Context { frontend: Some(&f), current: Some(&current), session_post: None },
        )
    }

    /// The same, from `current`.
    fn nav_from(url: &str, current: &str) -> Decision {
        let f = u(FRONTEND);
        let current = u(current);
        decide(
            &u(url),
            Request::Navigate,
            Context { frontend: Some(&f), current: Some(&current), session_post: None },
        )
    }

    fn new_window(url: &str, current: &str) -> Decision {
        let f = u(FRONTEND);
        let current = u(current);
        decide(
            &u(url),
            Request::NewWindow,
            Context { frontend: Some(&f), current: Some(&current), session_post: None },
        )
    }

    fn sign_in(backend: &str) -> Decision {
        Decision::StartSignIn { backend: u(backend) }
    }

    #[test]
    fn bundled_pages_are_allowed_in_window_only() {
        let page = if cfg!(windows) { "http://tauri.localhost/handoff.html" } else { "tauri://localhost/index.html" };
        assert_eq!(decide(&u(page), Request::Navigate, Context::default()), Decision::Allow);
        assert_eq!(decide(&u(page), Request::NewWindow, Context::default()), Decision::Deny);
    }

    #[test]
    fn bundled_origin_is_exact_per_platform() {
        let mac = ("tauri", "localhost");
        let win = ("http", "tauri.localhost");
        assert!(is_bundled_on(&u("tauri://localhost/index.html"), mac));
        assert!(!is_bundled_on(&u("tauri://localhost:8080/"), mac));
        assert!(!is_bundled_on(&u("http://tauri.localhost/"), mac));
        assert!(!is_bundled_on(&u("tauri://evil/"), mac));
        assert!(is_bundled_on(&u("http://tauri.localhost/handoff.html"), win));
        assert!(!is_bundled_on(&u("http://tauri.localhost:8080/"), win));
        assert!(!is_bundled_on(&u("https://tauri.localhost/"), win));
        assert!(!is_bundled_on(&u("tauri://localhost/"), win));
        assert!(!is_bundled_on(&u("http://tauri.localhost.evil.com/"), win));
        // This platform's check is one of the two, never both.
        assert_ne!(
            is_bundled(&u("tauri://localhost/")),
            is_bundled(&u("http://tauri.localhost/"))
        );
    }

    #[test]
    fn frontend_origin_stays_in_window() {
        assert_eq!(nav("https://app.example.com/"), Decision::Allow);
        assert_eq!(nav("https://app.example.com/w/1/sheets/abc?x=1"), Decision::Allow);
        // Origin, not host: another port or scheme is another site.
        assert_eq!(nav("https://app.example.com:8443/"), Decision::OpenExternal);
        assert_eq!(nav("http://app.example.com/"), Decision::OpenExternal);
    }

    #[test]
    fn other_origins_go_to_the_system_browser() {
        assert_eq!(nav("https://github.com/yorkie-team"), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/docs"), Decision::OpenExternal);
        assert_eq!(nav("mailto:someone@example.com"), Decision::OpenExternal);
        assert_eq!(new_window("https://github.com/", "https://app.example.com/w/1"), Decision::OpenExternal);
        // Without a server chosen (picker), every http(s) site is external.
        assert_eq!(
            decide(&u("https://app.example.com/"), Request::Navigate, Context::default()),
            Decision::OpenExternal
        );
    }

    #[test]
    fn dangerous_schemes_are_denied() {
        assert_eq!(nav("file:///etc/passwd"), Decision::Deny);
        assert_eq!(nav("vscode://file/x"), Decision::Deny);
        assert_eq!(nav("ftp://example.com/"), Decision::Deny);
        assert_eq!(nav("data:text/html,<h1>hi</h1>"), Decision::Deny);
        assert_eq!(new_window("data:text/html,x", FRONTEND), Decision::Deny);
    }

    #[test]
    fn about_and_frontend_blobs_are_allowed() {
        assert_eq!(nav("about:blank"), Decision::Allow);
        assert_eq!(nav("about:srcdoc"), Decision::Allow);
        assert_eq!(nav("blob:https://app.example.com/1234"), Decision::Allow);
        assert_eq!(new_window("about:blank", FRONTEND), Decision::Deny);
        assert_eq!(new_window("blob:https://app.example.com/1234", FRONTEND), Decision::Deny);
    }

    #[test]
    fn blobs_from_other_origins_are_denied() {
        assert_eq!(nav("blob:https://evil.example/1234"), Decision::Deny);
        assert_eq!(nav("blob:https://app.example.com:8443/1234"), Decision::Deny);
        assert_eq!(nav("blob:null/1234"), Decision::Deny);
        assert_eq!(
            decide(&u("blob:https://app.example.com/1"), Request::Navigate, Context::default()),
            Decision::Deny
        );
    }

    #[test]
    fn sign_in_is_intercepted_from_the_login_page_on_any_backend() {
        let login = "https://app.example.com/login";
        assert_eq!(nav_from("https://api.example.com/auth/github", login), sign_in("https://api.example.com"));
        assert_eq!(nav_from("https://app.example.com/auth/github", login), sign_in("https://app.example.com"));
        assert_eq!(
            nav_from("http://localhost:3000/auth/github?returnTo=%2Fw%2F1", "https://app.example.com/login?returnTo=%2Fw%2F1"),
            sign_in("http://localhost:3000")
        );
    }

    #[test]
    fn sign_in_links_anywhere_else_go_to_the_system_browser() {
        // A collaborator's hyperlink in a sheet, followed in the window.
        assert_eq!(nav("https://evil.example/auth/github"), Decision::OpenExternal);
        assert_eq!(nav("https://app.example.com/auth/github"), Decision::OpenExternal);
        // The same link through window.open, even from the login page.
        assert_eq!(new_window("https://evil.example/auth/github", "https://app.example.com/login"), Decision::OpenExternal);
        assert_eq!(new_window("https://app.example.com/auth/github", "https://app.example.com/login"), Decision::OpenExternal);
        // A login page on another origin, or a lookalike path.
        assert_eq!(nav_from("https://api.example.com/auth/github", "https://evil.example/login"), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/auth/github", "https://app.example.com/login/x"), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/auth/github", "https://app.example.com/w/1?next=/login"), Decision::OpenExternal);
        // A bundled page or no known current page.
        assert_eq!(nav_from("https://api.example.com/auth/github", "tauri://localhost/signin.html"), Decision::OpenExternal);
        let f = u(FRONTEND);
        assert_eq!(
            decide(&u("https://api.example.com/auth/github"), Request::Navigate, Context { frontend: Some(&f), current: None, session_post: None }),
            Decision::OpenExternal
        );
        // Before a server is chosen there is no login page to trust.
        let login = u("https://app.example.com/login");
        assert_eq!(
            decide(&u("https://api.example.com/auth/github"), Request::Navigate, Context { frontend: None, current: Some(&login), session_post: None }),
            Decision::OpenExternal
        );
    }

    #[test]
    fn sign_in_with_a_mode_or_another_path_is_not_intercepted() {
        let login = "https://app.example.com/login";
        assert_eq!(nav_from("https://api.example.com/auth/github?mode=desktop", login), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/auth/github?mode=cli&port=1", login), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/auth/github/", login), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/auth/github/callback?code=x", login), Decision::OpenExternal);
        assert_eq!(nav_from("https://api.example.com/x/auth/github", login), Decision::OpenExternal);
        assert_eq!(nav_from("https://app.example.com/auth/github?mode=", login), Decision::Allow);
    }

    #[test]
    fn handoff_post_is_allowed_only_while_pending_and_only_to_that_url() {
        let f = u(FRONTEND);
        let current = u("tauri://localhost/handoff.html");
        let post = u("https://api.example.com/auth/desktop/session");
        let ctx = Context { frontend: Some(&f), current: Some(&current), session_post: Some(&post) };
        assert_eq!(decide(&post, Request::Navigate, ctx), Decision::AllowSessionPost);
        assert_eq!(
            decide(&u("https://api.example.com/auth/desktop/session?x=1"), Request::Navigate, ctx),
            Decision::AllowSessionPost
        );
        assert_eq!(decide(&u("https://api.example.com/auth/me"), Request::Navigate, ctx), Decision::OpenExternal);
        assert_eq!(decide(&u("https://evil.example/auth/desktop/session"), Request::Navigate, ctx), Decision::OpenExternal);
        assert_eq!(decide(&post, Request::NewWindow, ctx), Decision::OpenExternal);
        // Not pending (or another window): external.
        assert_eq!(nav("https://api.example.com/auth/desktop/session"), Decision::OpenExternal);
    }

    #[test]
    fn new_windows_to_the_frontend_open_app_windows() {
        assert_eq!(new_window("https://app.example.com/w/1", "https://app.example.com/"), Decision::OpenAppWindow);
    }

    #[test]
    fn download_names_are_sanitized() {
        assert_eq!(sanitize_file_name("report.xlsx"), "report.xlsx");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("..\\..\\boot.ini"), "boot.ini");
        assert_eq!(sanitize_file_name("a:b.txt"), "a_b.txt");
        assert_eq!(sanitize_file_name(""), "download");
        assert_eq!(sanitize_file_name(".."), "download");
        assert_eq!(sanitize_file_name("dir/"), "download");
        assert_eq!(sanitize_file_name(".env"), ".env");
    }

    #[test]
    fn download_names_do_not_overwrite() {
        let taken = ["report.xlsx", "report (1).xlsx", "notes", "archive.tar.gz", ".env"];
        let exists = |n: &str| taken.contains(&n);
        assert_eq!(dedupe_file_name("fresh.csv", exists), "fresh.csv");
        assert_eq!(dedupe_file_name("report.xlsx", exists), "report (2).xlsx");
        assert_eq!(dedupe_file_name("notes", exists), "notes (1)");
        assert_eq!(dedupe_file_name("archive.tar.gz", exists), "archive.tar (1).gz");
        assert_eq!(dedupe_file_name(".env", exists), ".env (1)");
    }

    #[test]
    fn download_destination_uses_the_folder() {
        let dir = std::env::temp_dir().join(format!("wafflebase-dl-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert_eq!(download_destination(&dir, "b.txt"), dir.join("b.txt"));
        assert_eq!(download_destination(&dir, "a.txt"), dir.join("a (1).txt"));
        assert_eq!(download_destination(&dir, "../a.txt"), dir.join("a (1).txt"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
