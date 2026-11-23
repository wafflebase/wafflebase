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
    /// The `<backend>/auth/desktop/session` URL the handoff page is allowed to
    /// POST to, while a sign-in has a code waiting to be redeemed.
    pub session_post: Option<&'a Url>,
}

/// Whether a URL is one of the app's bundled pages: `tauri://localhost` on
/// macOS and Linux, `http(s)://tauri.localhost` on Windows.
pub fn is_bundled(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// A top-level `<backend>/auth/github` with no `mode`: the web sign-in link
/// the frontend renders. A URL that already carries `mode` (`cli`, `desktop`)
/// is some other flow's and is left alone.
fn is_web_github_sign_in(url: &Url) -> bool {
    url.path() == "/auth/github" && !url.query_pairs().any(|(key, _)| key == "mode")
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

    match url.scheme() {
        "http" | "https" => {}
        // In-page documents: `about:blank`/`about:srcdoc` frames and `blob:`/
        // `data:` documents have no other place to go. A `blob:` download is
        // not a navigation (WebKit routes it to the download hook directly).
        "about" | "blob" | "data" => {
            return match request {
                Request::Navigate => Decision::Allow,
                Request::NewWindow => Decision::Deny,
            };
        }
        // Links that name another app on purpose.
        "mailto" | "tel" => return Decision::OpenExternal,
        // `file:`, custom schemes and anything else: opening them would let a
        // remote page launch arbitrary handlers on this machine.
        _ => return Decision::Deny,
    }

    if is_web_github_sign_in(url) {
        let backend = Url::parse(&url.origin().ascii_serialization())
            .expect("an http(s) origin serializes to a valid URL");
        return Decision::StartSignIn { backend };
    }

    let is_frontend = ctx.frontend.is_some_and(|f| same_origin(url, f));
    match request {
        Request::Navigate => {
            if is_frontend {
                return Decision::Allow;
            }
            if let Some(target) = ctx.session_post {
                if same_origin(url, target) && url.path() == target.path() {
                    return Decision::Allow;
                }
            }
            Decision::OpenExternal
        }
        Request::NewWindow => {
            if is_frontend {
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

    fn nav(url: &str, frontend: &Url) -> Decision {
        decide(
            &u(url),
            Request::Navigate,
            Context {
                frontend: Some(frontend),
                session_post: None,
            },
        )
    }

    #[test]
    fn bundled_pages_are_allowed_in_window_only() {
        for page in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/handoff.html",
            "https://tauri.localhost/",
        ] {
            assert_eq!(decide(&u(page), Request::Navigate, Context::default()), Decision::Allow);
            assert_eq!(decide(&u(page), Request::NewWindow, Context::default()), Decision::Deny);
        }
        assert!(!is_bundled(&u("tauri://evil/")));
        assert!(!is_bundled(&u("https://tauri.localhost.evil.com/")));
    }

    #[test]
    fn frontend_origin_stays_in_window() {
        let f = u("https://app.example.com");
        assert_eq!(nav("https://app.example.com/", &f), Decision::Allow);
        assert_eq!(nav("https://app.example.com/w/1/sheets/abc?x=1", &f), Decision::Allow);
        // Origin, not host: another port or scheme is another site.
        assert_eq!(nav("https://app.example.com:8443/", &f), Decision::OpenExternal);
        assert_eq!(nav("http://app.example.com/", &f), Decision::OpenExternal);
    }

    #[test]
    fn other_origins_go_to_the_system_browser() {
        let f = u("https://app.example.com");
        assert_eq!(nav("https://github.com/yorkie-team", &f), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/docs", &f), Decision::OpenExternal);
        assert_eq!(nav("mailto:someone@example.com", &f), Decision::OpenExternal);
        assert_eq!(
            decide(&u("https://github.com/"), Request::NewWindow, Context { frontend: Some(&f), session_post: None }),
            Decision::OpenExternal
        );
        // Without a server chosen (picker), every http(s) site is external.
        assert_eq!(
            decide(&u("https://app.example.com/"), Request::Navigate, Context::default()),
            Decision::OpenExternal
        );
    }

    #[test]
    fn dangerous_schemes_are_denied() {
        let f = u("https://app.example.com");
        assert_eq!(nav("file:///etc/passwd", &f), Decision::Deny);
        assert_eq!(nav("vscode://file/x", &f), Decision::Deny);
        assert_eq!(nav("ftp://example.com/", &f), Decision::Deny);
    }

    #[test]
    fn in_page_documents_are_allowed() {
        let f = u("https://app.example.com");
        assert_eq!(nav("about:blank", &f), Decision::Allow);
        assert_eq!(nav("about:srcdoc", &f), Decision::Allow);
        assert_eq!(nav("blob:https://app.example.com/1234", &f), Decision::Allow);
        assert_eq!(
            decide(&u("about:blank"), Request::NewWindow, Context { frontend: Some(&f), session_post: None }),
            Decision::Deny
        );
    }

    #[test]
    fn web_github_sign_in_is_intercepted_on_any_origin() {
        let f = u("https://app.example.com");
        let expect = |backend: &str| Decision::StartSignIn { backend: u(backend) };
        assert_eq!(nav("https://api.example.com/auth/github", &f), expect("https://api.example.com"));
        assert_eq!(nav("https://app.example.com/auth/github", &f), expect("https://app.example.com"));
        assert_eq!(
            nav("http://localhost:3000/auth/github?redirect=%2Fw%2F1", &f),
            expect("http://localhost:3000")
        );
        assert_eq!(
            decide(&u("https://api.example.com/auth/github"), Request::NewWindow, Context { frontend: Some(&f), session_post: None }),
            expect("https://api.example.com")
        );
    }

    #[test]
    fn sign_in_with_a_mode_or_another_path_is_not_intercepted() {
        let f = u("https://app.example.com");
        assert_eq!(nav("https://api.example.com/auth/github?mode=desktop", &f), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/auth/github?mode=cli&port=1", &f), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/auth/github/", &f), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/auth/github/callback?code=x", &f), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/x/auth/github", &f), Decision::OpenExternal);
        assert_eq!(nav("https://app.example.com/auth/github?mode=", &f), Decision::Allow);
    }

    #[test]
    fn handoff_post_is_allowed_only_while_pending_and_only_to_that_url() {
        let f = u("https://app.example.com");
        let post = u("https://api.example.com/auth/desktop/session");
        let ctx = Context { frontend: Some(&f), session_post: Some(&post) };
        assert_eq!(decide(&post, Request::Navigate, ctx), Decision::Allow);
        assert_eq!(
            decide(&u("https://api.example.com/auth/desktop/session?x=1"), Request::Navigate, ctx),
            Decision::Allow
        );
        assert_eq!(decide(&u("https://api.example.com/auth/me"), Request::Navigate, ctx), Decision::OpenExternal);
        assert_eq!(decide(&post, Request::NewWindow, ctx), Decision::OpenExternal);
        assert_eq!(nav("https://api.example.com/auth/desktop/session", &f), Decision::OpenExternal);
    }

    #[test]
    fn new_windows_to_the_frontend_open_app_windows() {
        let f = u("https://app.example.com");
        let ctx = Context { frontend: Some(&f), session_post: None };
        assert_eq!(decide(&u("https://app.example.com/w/1"), Request::NewWindow, ctx), Decision::OpenAppWindow);
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
