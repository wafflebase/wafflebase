//! The loopback listener and PKCE pair for desktop sign-in.
//!
//! This mirrors the CLI's login (`packages/cli/src/commands/login.ts`,
//! `docs/design/cli.md` §3.1) rule for rule:
//!
//! - bind `127.0.0.1` only, on a random port;
//! - a per-attempt nonce (32 random bytes, hex) that the backend echoes back
//!   as the callback's `state`, compared in constant time;
//! - a PKCE verifier (32 random bytes, base64url) held in memory only; just
//!   its SHA-256 challenge goes into the authorization URL;
//! - the browser is handed `http://127.0.0.1:<port>/launch/<token>` (32
//!   random bytes), which redirects once to the authorization URL and answers
//!   `410` afterwards, so the authorization URL never reaches a child
//!   process's argv;
//! - `/callback` accepts only `GET` with the right `state`; anything else is
//!   refused with `403` and the wait goes on, so a forged hit cannot end it;
//! - a `Host` header that is not a loopback literal on this port is refused
//!   (DNS rebinding);
//! - five minutes, the server's own budget for one login.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tiny_http::{Header, Response, Server};
use url::Url;

/// How long the listener waits for the callback.
pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const LAUNCH_PREFIX: &str = "/launch/";

fn random_bytes() -> [u8; 32] {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("the OS random source is available");
    buf
}

/// Per-attempt secret bound into the OAuth round trip: 32 bytes, hex.
pub fn create_nonce() -> String {
    hex::encode(random_bytes())
}

/// PKCE verifier: 32 bytes, base64url without padding (43 characters).
pub fn create_verifier() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes())
}

/// PKCE S256 challenge: `base64url(sha256(verifier))`, RFC 7636 §4.2.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Constant-time comparison of a presented value against the expected one.
pub fn secret_matches(expected: &str, received: Option<&str>) -> bool {
    match received {
        Some(received) if received.len() == expected.len() => {
            bool::from(expected.as_bytes().ct_eq(received.as_bytes()))
        }
        _ => false,
    }
}

/// Whether a `Host` header addresses this loopback listener: `127.0.0.1`,
/// `localhost` or `[::1]`, with this port or no port. A missing `Host`
/// (HTTP/1.0) is allowed; a browser always sends one.
pub fn is_loopback_host_header(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return true };
    let host = host.trim().to_ascii_lowercase();
    // IPv6 literals are bracketed in `Host` (RFC 7230 §5.4); split the port
    // off after the bracket, otherwise at the first colon.
    let split_at = if host.starts_with('[') {
        match host.find(']') {
            Some(end) => end + 1,
            None => return false,
        }
    } else {
        host.find(':').unwrap_or(host.len())
    };
    let (name, rest) = host.split_at(split_at);
    if !matches!(name, "127.0.0.1" | "localhost" | "[::1]") {
        return false;
    }
    if rest.is_empty() {
        return true;
    }
    match rest.strip_prefix(':') {
        Some(digits) if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) => {
            digits.parse::<u32>().is_ok_and(|n| n == u32::from(port))
        }
        _ => false,
    }
}

/// `<backend>/auth/github?mode=desktop&port=…&nonce=…&challenge=…`.
pub fn authorization_url(backend: &Url, port: u16, nonce: &str, challenge: &str) -> Url {
    let mut url = backend
        .join("/auth/github")
        .expect("a backend origin joins a path");
    url.query_pairs_mut()
        .append_pair("mode", "desktop")
        .append_pair("port", &port.to_string())
        .append_pair("nonce", nonce)
        .append_pair("challenge", challenge);
    url
}

/// Why a request that reached the listener was not accepted. Each is said
/// to the browser tab and reported to the app, and the wait goes on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    NoState,
    BadState,
    NotGet,
    NotLoopback,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Self::NoState => {
                "the redirect carried no `state`. The server is likely older than \
                 this app and cannot do desktop sign-in."
            }
            Self::BadState => {
                "a callback carried a `state` that does not match this sign-in, so it \
                 did not come from the browser window this app opened and was ignored."
            }
            Self::NotGet => {
                "a non-GET request reached the callback. The server redirects the \
                 browser with a plain GET, so this was not it."
            }
            Self::NotLoopback => {
                "a request addressed to a host other than this loopback listener \
                 reached it (DNS rebinding), and was ignored."
            }
        }
    }
}

/// How a sign-in wait ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The server's redirect, with the one-time code to redeem.
    Code(String),
    /// The server's redirect, reporting that it would not sign this account
    /// in (`?error=<code>`), reduced to a safe vocabulary.
    ServerRefused(String),
    /// Five minutes passed. Carries the last refusal, if there was one.
    TimedOut(Option<Refusal>),
    /// A newer sign-in or the person cancelled this one.
    Cancelled,
}

/// Something worth reporting while the wait goes on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    LaunchRedirected,
    LaunchSpent,
    Refused(Refusal),
}

/// Prose for a server-reported refusal. The value is echoed into the window,
/// so anything outside a closed vocabulary is reduced to a fixed shape.
pub fn server_refusal_message(code: &str) -> String {
    match code {
        "unverified_email" => "Sign-in was refused: the account has no verified email \
            address. Verify one with the provider and try again."
            .to_string(),
        "no_email" => "Sign-in was refused: the account shared no email address, which \
            Wafflebase signs you in by."
            .to_string(),
        "email_conflict" => "Sign-in was refused: that email already has a Wafflebase \
            account created with the other sign-in provider. Sign in once with that \
            provider, then try again."
            .to_string(),
        other => {
            let safe = if !other.is_empty()
                && other.len() <= 40
                && other
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            {
                other
            } else {
                "unknown"
            };
            format!("Sign-in was refused by the server ({safe}).")
        }
    }
}

/// A response the listener sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub location: Option<String>,
    pub html: bool,
    pub body: String,
}

impl Reply {
    fn text(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            location: None,
            html: false,
            body: body.into(),
        }
    }
    fn html(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            location: None,
            html: true,
            body: body.into(),
        }
    }
}

fn page(title: &str, message: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
<meta name=\"referrer\" content=\"no-referrer\"><title>Wafflebase</title>\
<style>body{{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;\
display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fafafa;color:#1a1a1a}}\
.card{{max-width:30rem;text-align:center;padding:2.5rem;background:#fff;border-radius:12px;\
box-shadow:0 1px 3px rgba(0,0,0,.08),0 4px 12px rgba(0,0,0,.04)}}h2{{margin:0 0 .75rem;font-size:1.25rem}}\
p{{margin:0;color:#444;font-size:.95rem;line-height:1.5}}</style></head>\
<body><div class=\"card\"><h2>{title}</h2><p>{message}</p></div></body></html>"
    )
}

/// The request-handling state of one sign-in, apart from the socket, so the
/// rules can be read (and are tested) in one place.
pub struct Gate {
    port: u16,
    nonce: String,
    launch_token: String,
    launch_target: Option<String>,
}

impl Gate {
    pub fn new(port: u16, nonce: String, launch_token: String, authorization_url: String) -> Self {
        Self {
            port,
            nonce,
            launch_token,
            launch_target: Some(authorization_url),
        }
    }

    /// Answer one request. The second value settles the wait when present.
    pub fn handle(
        &mut self,
        method: &str,
        path_and_query: &str,
        host: Option<&str>,
    ) -> (Reply, Option<Outcome>, Option<Event>) {
        if !is_loopback_host_header(host, self.port) {
            return self.refuse(Refusal::NotLoopback);
        }
        let Ok(url) = Url::parse("http://127.0.0.1/").and_then(|base| base.join(path_and_query))
        else {
            return (Reply::text(400, "Bad request"), None, None);
        };

        if let Some(presented) = url.path().strip_prefix(LAUNCH_PREFIX) {
            let ours = secret_matches(&self.launch_token, Some(presented));
            if ours {
                // Only a GET follows the link. A HEAD probe (a link checker,
                // a prefetch) must not spend it before the browser does.
                if method != "GET" {
                    return (Reply::text(405, "Method not allowed"), None, None);
                }
                if let Some(target) = self.launch_target.take() {
                    let reply = Reply {
                        status: 302,
                        location: Some(target),
                        html: false,
                        body: String::new(),
                    };
                    return (reply, None, Some(Event::LaunchRedirected));
                }
                // Spent: something opened the one-time link first. Say what
                // to do, never re-offer the authorization URL.
                let body = page(
                    "This sign-in link was already used",
                    "The link that starts a desktop sign-in works exactly once, and something \
                     opened it before this window did. Return to Wafflebase and sign in again.",
                );
                return (Reply::html(410, body), None, Some(Event::LaunchSpent));
            }
            // Not our token: say nothing that confirms a sign-in is running.
            return (Reply::text(404, "Not found"), None, None);
        }

        if url.path() != "/callback" {
            return (Reply::text(404, "Not found"), None, None);
        }
        if method != "GET" {
            return self.refuse(Refusal::NotGet);
        }

        let param = |name: &str| {
            url.query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
        };
        let code = param("code");
        let failure = param("error");
        if code.is_none() && failure.is_none() {
            return (Reply::text(400, "Missing code"), None, None);
        }
        let state = param("state");
        if !secret_matches(&self.nonce, state.as_deref()) {
            return self.refuse(if state.is_none() {
                Refusal::NoState
            } else {
                Refusal::BadState
            });
        }

        if let Some(failure) = failure {
            let body = page(
                "Sign-in was refused",
                "Return to Wafflebase. It says what to do next.",
            );
            return (
                Reply::html(200, body),
                Some(Outcome::ServerRefused(failure)),
                None,
            );
        }
        let code = code.expect("checked above");
        let body = page(
            "Return to Wafflebase",
            "Go back to the Wafflebase app to finish signing in. You can close this tab.",
        );
        (Reply::html(200, body), Some(Outcome::Code(code)), None)
    }

    fn refuse(&self, refusal: Refusal) -> (Reply, Option<Outcome>, Option<Event>) {
        let body = format!("Wafflebase refused this callback: {}\n", refusal.message());
        (Reply::text(403, body), None, Some(Event::Refused(refusal)))
    }
}

/// Stops a running listener from another thread.
#[derive(Clone)]
pub struct Canceller {
    server: Arc<Server>,
    cancelled: Arc<AtomicBool>,
}

impl Canceller {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.server.unblock();
    }
}

/// One sign-in attempt's loopback listener.
pub struct Listener {
    server: Arc<Server>,
    cancelled: Arc<AtomicBool>,
    gate: Gate,
    port: u16,
    launch_url: String,
}

impl Listener {
    /// Bind `127.0.0.1:<random>` and arm the launch redirect to the URL
    /// `authorization` builds for the bound port.
    pub fn start(nonce: &str, authorization: impl FnOnce(u16) -> Url) -> std::io::Result<Self> {
        let server = Server::http("127.0.0.1:0").map_err(std::io::Error::other)?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|addr| addr.port())
            .ok_or_else(|| std::io::Error::other("listener has no IP address"))?;
        let token = URL_SAFE_NO_PAD.encode(random_bytes());
        let launch_url = format!("http://127.0.0.1:{port}{LAUNCH_PREFIX}{token}");
        let gate = Gate::new(
            port,
            nonce.to_string(),
            token,
            authorization(port).to_string(),
        );
        Ok(Self {
            server: Arc::new(server),
            cancelled: Arc::new(AtomicBool::new(false)),
            gate,
            port,
            launch_url,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// The single-use URL to hand the browser.
    pub fn launch_url(&self) -> &str {
        &self.launch_url
    }

    pub fn canceller(&self) -> Canceller {
        Canceller {
            server: self.server.clone(),
            cancelled: self.cancelled.clone(),
        }
    }

    /// Serve requests until a callback settles the wait, the timeout passes or
    /// the listener is cancelled. Blocking; run it off the main thread.
    pub fn wait(mut self, timeout: Duration, mut on_event: impl FnMut(Event)) -> Outcome {
        let deadline = Instant::now() + timeout;
        let mut last_refusal = None;
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return Outcome::Cancelled;
            }
            let now = Instant::now();
            if now >= deadline {
                return Outcome::TimedOut(last_refusal);
            }
            let request = match self.server.recv_timeout(deadline - now) {
                Ok(Some(request)) => request,
                Ok(None) => continue,
                Err(_) => continue,
            };
            let method = request.method().as_str().to_string();
            let path = request.url().to_string();
            let host = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Host"))
                .map(|h| h.value.as_str().to_string());
            let (reply, outcome, event) = self.gate.handle(&method, &path, host.as_deref());
            if let Some(event) = event {
                if let Event::Refused(refusal) = event {
                    last_refusal = Some(refusal);
                }
                on_event(event);
            }
            let _ = request.respond(to_response(reply));
            if let Some(outcome) = outcome {
                return outcome;
            }
        }
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header is valid")
}

fn to_response(reply: Reply) -> Response<std::io::Cursor<Vec<u8>>> {
    let content_type = if reply.html {
        "text/html; charset=utf-8"
    } else {
        "text/plain; charset=utf-8"
    };
    let mut response = Response::from_string(reply.body)
        .with_status_code(reply.status)
        .with_header(header("Content-Type", content_type))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("Referrer-Policy", "no-referrer"));
    if let Some(location) = reply.location {
        response = response.with_header(header("Location", &location));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn pkce_challenge_matches_rfc7636_appendix_b() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn nonce_and_verifier_shapes() {
        let nonce = create_nonce();
        assert_eq!(nonce.len(), 64);
        assert!(nonce.bytes().all(|b| b.is_ascii_hexdigit()));
        let verifier = create_verifier();
        assert_eq!(verifier.len(), 43);
        assert!(verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(create_nonce(), nonce);
    }

    #[test]
    fn secret_matching() {
        assert!(secret_matches("abc", Some("abc")));
        assert!(!secret_matches("abc", Some("abd")));
        assert!(!secret_matches("abc", Some("ab")));
        assert!(!secret_matches("abc", None));
    }

    #[test]
    fn host_header_rules() {
        assert!(is_loopback_host_header(None, 4000));
        assert!(is_loopback_host_header(Some("127.0.0.1:4000"), 4000));
        assert!(is_loopback_host_header(Some("localhost:4000"), 4000));
        assert!(is_loopback_host_header(Some("[::1]:4000"), 4000));
        assert!(is_loopback_host_header(Some("LOCALHOST"), 4000));
        assert!(is_loopback_host_header(Some("127.0.0.1"), 4000));
        assert!(!is_loopback_host_header(Some("127.0.0.1:4001"), 4000));
        assert!(!is_loopback_host_header(Some("evil.example:4000"), 4000));
        assert!(!is_loopback_host_header(
            Some("127.0.0.1.nip.io:4000"),
            4000
        ));
        assert!(!is_loopback_host_header(Some("[::1"), 4000));
        assert!(!is_loopback_host_header(Some("127.0.0.1:"), 4000));
        assert!(!is_loopback_host_header(Some("127.0.0.1:40a0"), 4000));
    }

    #[test]
    fn authorization_url_carries_the_contract() {
        let url = authorization_url(
            &Url::parse("https://api.example.com").unwrap(),
            4242,
            "n0",
            "c0",
        );
        assert_eq!(
            url.as_str(),
            "https://api.example.com/auth/github?mode=desktop&port=4242&nonce=n0&challenge=c0"
        );
    }

    #[test]
    fn server_refusal_vocabulary() {
        assert!(server_refusal_message("email_conflict").contains("other sign-in provider"));
        assert_eq!(
            server_refusal_message("weird_code"),
            "Sign-in was refused by the server (weird_code)."
        );
        assert_eq!(
            server_refusal_message("<script>"),
            "Sign-in was refused by the server (unknown)."
        );
    }

    // Socket-level tests: a real listener and raw HTTP, so the Host header and
    // the method can be anything a hostile client sends.

    struct Running {
        port: u16,
        launch_path: String,
        outcome: mpsc::Receiver<Outcome>,
        events: mpsc::Receiver<Event>,
        canceller: Canceller,
    }

    fn start(nonce: &str, timeout: Duration) -> Running {
        let listener = Listener::start(nonce, |port| {
            authorization_url(
                &Url::parse("https://api.example.com").unwrap(),
                port,
                nonce,
                "chal",
            )
        })
        .unwrap();
        let port = listener.port();
        let launch_path =
            listener.launch_url()[format!("http://127.0.0.1:{port}").len()..].to_string();
        let canceller = listener.canceller();
        let (out_tx, outcome) = mpsc::channel();
        let (ev_tx, events) = mpsc::channel();
        thread::spawn(move || {
            let outcome = listener.wait(timeout, |e| {
                let _ = ev_tx.send(e);
            });
            let _ = out_tx.send(outcome);
        });
        Running {
            port,
            launch_path,
            outcome,
            events,
            canceller,
        }
    }

    fn raw(port: u16, method: &str, path: &str, host: Option<&str>) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut req = format!("{method} {path} HTTP/1.1\r\n");
        if let Some(host) = host {
            req.push_str(&format!("Host: {host}\r\n"));
        }
        req.push_str("Connection: close\r\nContent-Length: 0\r\n\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let status = response
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        (status, response)
    }

    fn get(r: &Running, path: &str) -> (u16, String) {
        raw(r.port, "GET", path, Some(&format!("127.0.0.1:{}", r.port)))
    }

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn listener_binds_loopback_only() {
        let r = start(NONCE, Duration::from_secs(5));
        let addr = format!("127.0.0.1:{}", r.port);
        assert!(TcpStream::connect(&addr).is_ok());
        r.canceller.cancel();
        assert_eq!(
            r.outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Cancelled
        );
    }

    #[test]
    fn a_head_probe_does_not_spend_the_launch_link() {
        let r = start(NONCE, Duration::from_secs(10));
        let host = format!("127.0.0.1:{}", r.port);
        let (status, _) = raw(r.port, "HEAD", &r.launch_path, Some(&host));
        assert_eq!(status, 405);
        let (status, _) = get(&r, &r.launch_path);
        assert_eq!(status, 302);
        assert_eq!(r.events.recv().unwrap(), Event::LaunchRedirected);
        r.canceller.cancel();
    }

    #[test]
    fn launch_redirects_once_then_answers_410() {
        let r = start(NONCE, Duration::from_secs(10));
        let (status, response) = get(&r, &r.launch_path);
        assert_eq!(status, 302);
        let location = response
            .lines()
            .find_map(|l| {
                l.strip_prefix("Location: ")
                    .or_else(|| l.strip_prefix("location: "))
            })
            .unwrap()
            .trim()
            .to_string();
        assert_eq!(
            location,
            format!(
                "https://api.example.com/auth/github?mode=desktop&port={}&nonce={NONCE}&challenge=chal",
                r.port
            )
        );
        assert_eq!(r.events.recv().unwrap(), Event::LaunchRedirected);

        let (status, response) = get(&r, &r.launch_path);
        assert_eq!(status, 410);
        assert!(
            !response.contains("api.example.com"),
            "the spent link never re-offers the URL"
        );
        assert_eq!(r.events.recv().unwrap(), Event::LaunchSpent);

        // A token that is not ours is a bare 404.
        let (status, _) = get(&r, "/launch/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert_eq!(status, 404);
        r.canceller.cancel();
    }

    #[test]
    fn callback_with_matching_state_settles_with_the_code() {
        let r = start(NONCE, Duration::from_secs(10));
        let (status, body) = get(&r, &format!("/callback?code=the-code&state={NONCE}"));
        assert_eq!(status, 200);
        assert!(body.contains("Return to Wafflebase"));
        assert_eq!(
            r.outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Code("the-code".into())
        );
    }

    #[test]
    fn forged_callbacks_are_refused_and_the_wait_goes_on() {
        let r = start(NONCE, Duration::from_secs(10));

        let wrong = format!("/callback?code=attacker&state={}", "f".repeat(64));
        let (status, body) = get(&r, &wrong);
        assert_eq!(status, 403);
        assert!(body.contains("does not match"));
        assert_eq!(r.events.recv().unwrap(), Event::Refused(Refusal::BadState));

        let (status, body) = get(&r, "/callback?code=attacker");
        assert_eq!(status, 403);
        assert!(
            body.contains("no `state`"),
            "missing state names its cause: {body}"
        );
        assert_eq!(r.events.recv().unwrap(), Event::Refused(Refusal::NoState));

        let (status, _) = raw(
            r.port,
            "POST",
            &format!("/callback?code=x&state={NONCE}"),
            Some(&format!("127.0.0.1:{}", r.port)),
        );
        assert_eq!(status, 403);
        assert_eq!(r.events.recv().unwrap(), Event::Refused(Refusal::NotGet));

        let (status, _) = raw(
            r.port,
            "GET",
            &format!("/callback?code=x&state={NONCE}"),
            Some(&format!("rebind.example:{}", r.port)),
        );
        assert_eq!(status, 403);
        assert_eq!(
            r.events.recv().unwrap(),
            Event::Refused(Refusal::NotLoopback)
        );

        let (status, _) = raw(
            r.port,
            "GET",
            &format!("/callback?code=x&state={NONCE}"),
            Some("127.0.0.1:1"),
        );
        assert_eq!(status, 403);
        assert_eq!(
            r.events.recv().unwrap(),
            Event::Refused(Refusal::NotLoopback)
        );

        assert!(r.outcome.try_recv().is_err(), "no refusal settles the wait");

        // The genuine redirect still lands.
        let (status, _) = get(&r, &format!("/callback?code=real&state={NONCE}"));
        assert_eq!(status, 200);
        assert_eq!(
            r.outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::Code("real".into())
        );
    }

    #[test]
    fn server_reported_refusal_settles_only_with_our_state() {
        let r = start(NONCE, Duration::from_secs(10));
        let (status, _) = get(&r, "/callback?error=email_conflict&state=nope");
        assert_eq!(status, 403);
        let (status, _) = get(&r, &format!("/callback?error=email_conflict&state={NONCE}"));
        assert_eq!(status, 200);
        assert_eq!(
            r.outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::ServerRefused("email_conflict".into())
        );
    }

    #[test]
    fn other_paths_are_404_and_missing_code_is_400() {
        let r = start(NONCE, Duration::from_secs(10));
        assert_eq!(get(&r, "/").0, 404);
        assert_eq!(get(&r, "/callbackx").0, 404);
        assert_eq!(get(&r, &format!("/callback?state={NONCE}")).0, 400);
        r.canceller.cancel();
    }

    #[test]
    fn timeout_reports_the_last_refusal() {
        let r = start(NONCE, Duration::from_millis(600));
        assert_eq!(get(&r, "/callback?code=x").0, 403);
        assert_eq!(
            r.outcome.recv_timeout(Duration::from_secs(5)).unwrap(),
            Outcome::TimedOut(Some(Refusal::NoState))
        );
    }
}
