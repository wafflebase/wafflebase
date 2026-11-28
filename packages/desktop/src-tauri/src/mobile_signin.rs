//! The iOS app's half of sign-in: the rules for the `wafflebase://` callback
//! that replaces the desktop's loopback listener (`docs/design/desktop-app.md`
//! §11).
//!
//! iOS suspends a backgrounded app within seconds of Safari opening, listener
//! included, so the backend redirects to the private-use URI scheme
//! `wafflebase://auth/callback` (RFC 8252 §7.1) instead of
//! `http://127.0.0.1:<port>/callback`. The query is the loopback callback's,
//! unchanged: `?code=<code>&state=<nonce>`, or `?error=<reason>&state=<nonce>`.
//!
//! Any app can register the same scheme, and iOS does not say which one gets
//! the URL (RFC 8252 §8.1), so the scheme is not trusted for anything:
//!
//! - an intercepted code is useless, because it is bound to the PKCE
//!   challenge whose verifier never leaves this process;
//! - a forged callback (`wafflebase://auth/callback?code=<attacker's>`) is
//!   refused unless its `state` equals the nonce of the sign-in this app is
//!   running, compared in constant time, and the nonce is spent by the first
//!   callback that carries it, so a second delivery finds nothing pending.
//!
//! The nonce and verifier come from `login.rs`, the same generators the
//! desktop and the CLI use. This module is compiled on every target so its
//! rules run in the host's `cargo test`; only the deep-link handler that
//! feeds it is iOS-only (`lib.rs`).

use tokio::sync::oneshot;
use url::Url;

use crate::login::{self, Outcome, Refusal};

/// The scheme the app registers (`plugins.deep-link` in
/// `tauri.ios.conf.json`), and the callback the backend redirects to
/// (`MOBILE_CALLBACK_URL` in the backend's `cli-auth.store.ts`).
pub const SCHEME: &str = "wafflebase";
const CALLBACK_HOST: &str = "auth";
const CALLBACK_PATH: &str = "/callback";

/// `<backend>/auth/github?mode=mobile&nonce=…&challenge=…`: the desktop's
/// authorization URL without a port, since the callback is the app's scheme.
pub fn authorization_url(backend: &Url, nonce: &str, challenge: &str) -> Url {
    let mut url = backend
        .join("/auth/github")
        .expect("a backend origin joins a path");
    url.query_pairs_mut()
        .append_pair("mode", "mobile")
        .append_pair("nonce", nonce)
        .append_pair("challenge", challenge);
    url
}

/// This app's verdict on a server's `mobile.github` answer in
/// `/auth/providers`. The backend offers it under the same condition as
/// `desktop.github`, and iOS hands off from `tauri://localhost`, an origin
/// every server accepts, so there is no origin field to check.
pub fn verdict(github: Option<bool>) -> Result<(), String> {
    match github {
        Some(true) => Ok(()),
        Some(false) => Err(
            "This server has mobile sign-in turned off: it needs an https sign-in \
             address, or COOKIE_SECURE=true behind a TLS proxy. Ask its \
             administrator, or sign in from a web browser."
                .to_string(),
        ),
        None => Err(
            "This server is too old for mobile sign-in. Ask its administrator to \
             upgrade Wafflebase, or sign in from a web browser."
                .to_string(),
        ),
    }
}

/// Why a delivered URL did not settle the sign-in. None of them ends the
/// wait: the genuine redirect can still arrive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    /// Not `wafflebase://auth/callback` at all (another scheme, host or
    /// path, a port or credentials): not a sign-in callback.
    NotCallback,
    /// The callback, but not in the shape the backend sends: no `code` or
    /// `error`, an empty one, or a parameter given twice.
    Malformed,
    /// The callback's `state` is missing or is not this sign-in's nonce.
    Refused(Refusal),
}

/// Read a delivered URL as the callback for the sign-in whose nonce is
/// `nonce`. Mirrors the loopback `Gate`'s `/callback` rules: `code` or
/// `error` must be present, `state` must match in constant time, and a
/// server-reported `error` wins over a `code`. Stricter in one way: a
/// parameter given twice is refused rather than read first-wins, since the
/// backend never sends one twice and the URL may come from any app.
pub fn parse_callback(url: &Url, nonce: &str) -> Result<Outcome, Rejection> {
    let is_callback = url.scheme() == SCHEME
        && url.host_str() == Some(CALLBACK_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == CALLBACK_PATH;
    if !is_callback {
        return Err(Rejection::NotCallback);
    }

    let mut code = None;
    let mut error = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        let slot = match key.as_ref() {
            "code" => &mut code,
            "error" => &mut error,
            "state" => &mut state,
            _ => continue,
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(Rejection::Malformed);
        }
    }
    if code.is_none() && error.is_none() {
        return Err(Rejection::Malformed);
    }
    if code.as_deref() == Some("") || error.as_deref() == Some("") {
        return Err(Rejection::Malformed);
    }
    if !login::secret_matches(nonce, state.as_deref()) {
        return Err(Rejection::Refused(if state.is_none() {
            Refusal::NoState
        } else {
            Refusal::BadState
        }));
    }
    Ok(match (error, code) {
        (Some(error), _) => Outcome::ServerRefused(error),
        (None, Some(code)) => Outcome::Code(code),
        (None, None) => unreachable!("checked above"),
    })
}

/// A sign-in waiting for its scheme callback: the nonce it accepts and the
/// channel the accepted outcome goes down. Dropping it (a newer sign-in, a
/// cancel, a failure) closes the channel, which the waiting task reads as
/// `Outcome::Cancelled`.
pub struct Pending {
    nonce: String,
    tx: oneshot::Sender<Outcome>,
    last_refusal: Option<Refusal>,
}

/// What became of one delivered URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// It settled the sign-in; the pending nonce is spent.
    Accepted,
    /// The sign-in keeps waiting.
    Rejected(Rejection),
}

impl Pending {
    pub fn new(nonce: &str) -> (Self, oneshot::Receiver<Outcome>) {
        let (tx, rx) = oneshot::channel();
        let pending = Self {
            nonce: nonce.to_string(),
            tx,
            last_refusal: None,
        };
        (pending, rx)
    }

    /// The last `state` refusal, for the timeout message.
    pub fn last_refusal(&self) -> Option<Refusal> {
        self.last_refusal
    }

    /// Check `url` against this sign-in. `Ok` carries the outcome to settle
    /// it with (the caller spends `self` through `settle`); a refusal of the
    /// `state` is remembered for the timeout message.
    pub fn check(&mut self, url: &Url) -> Result<Outcome, Rejection> {
        let checked = parse_callback(url, &self.nonce);
        if let Err(Rejection::Refused(refusal)) = checked {
            self.last_refusal = Some(refusal);
        }
        checked
    }

    /// Hand the accepted outcome to the waiting task, spending the nonce.
    pub fn settle(self, outcome: Outcome) {
        // The task may be gone (superseded meanwhile); nothing to do then.
        let _ = self.tx.send(outcome);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn callback(query: &str) -> Url {
        u(&format!("wafflebase://auth/callback?{query}"))
    }

    #[test]
    fn authorization_url_carries_the_contract() {
        assert_eq!(
            authorization_url(&u("https://api.example.com"), "n0", "c0").as_str(),
            "https://api.example.com/auth/github?mode=mobile&nonce=n0&challenge=c0"
        );
    }

    /// Same as the backend's `MOBILE_CALLBACK_URL`, which the parser has to
    /// read as a host and a path.
    #[test]
    fn the_callback_url_parses_as_host_and_path() {
        let url = u("wafflebase://auth/callback");
        assert_eq!(url.scheme(), SCHEME);
        assert_eq!(url.host_str(), Some(CALLBACK_HOST));
        assert_eq!(url.path(), CALLBACK_PATH);
    }

    #[test]
    fn a_callback_with_our_state_settles_with_the_code() {
        assert_eq!(
            parse_callback(&callback(&format!("code=the-code&state={NONCE}")), NONCE),
            Ok(Outcome::Code("the-code".into()))
        );
        // Order does not matter, and other parameters are ignored.
        assert_eq!(
            parse_callback(&callback(&format!("state={NONCE}&utm=x&code=c%2Fd")), NONCE),
            Ok(Outcome::Code("c/d".into()))
        );
    }

    #[test]
    fn a_wrong_or_missing_state_is_refused() {
        assert_eq!(
            parse_callback(
                &callback(&format!("code=attacker&state={}", "f".repeat(64))),
                NONCE
            ),
            Err(Rejection::Refused(Refusal::BadState))
        );
        assert_eq!(
            parse_callback(&callback(&format!("code=x&state={}", &NONCE[..63])), NONCE),
            Err(Rejection::Refused(Refusal::BadState))
        );
        assert_eq!(
            parse_callback(&callback("code=attacker"), NONCE),
            Err(Rejection::Refused(Refusal::NoState))
        );
        assert_eq!(
            parse_callback(&callback("code=attacker&state="), NONCE),
            Err(Rejection::Refused(Refusal::BadState))
        );
    }

    #[test]
    fn anything_but_the_callback_is_not_a_callback() {
        let q = format!("code=x&state={NONCE}");
        for url in [
            format!("wafflebase://auth/other?{q}"),
            format!("wafflebase://auth/callback/?{q}"),
            format!("wafflebase://auth/?{q}"),
            format!("wafflebase://evil/callback?{q}"),
            format!("wafflebase://AUTH/callback?{q}"),
            format!("wafflebase://auth:1/callback?{q}"),
            format!("wafflebase://user@auth/callback?{q}"),
            format!("wafflebase:auth/callback?{q}"),
            format!("wafflebase:///auth/callback?{q}"),
            format!("evilbase://auth/callback?{q}"),
            format!("https://auth/callback?{q}"),
            format!("http://127.0.0.1:4242/callback?{q}"),
        ] {
            assert_eq!(
                parse_callback(&u(&url), NONCE),
                Err(Rejection::NotCallback),
                "{url}"
            );
        }
    }

    #[test]
    fn a_callback_without_code_or_error_is_malformed() {
        assert_eq!(
            parse_callback(&callback(&format!("state={NONCE}")), NONCE),
            Err(Rejection::Malformed)
        );
        assert_eq!(
            parse_callback(&u("wafflebase://auth/callback"), NONCE),
            Err(Rejection::Malformed)
        );
        assert_eq!(
            parse_callback(&callback(&format!("code=&state={NONCE}")), NONCE),
            Err(Rejection::Malformed)
        );
        assert_eq!(
            parse_callback(&callback(&format!("error=&state={NONCE}")), NONCE),
            Err(Rejection::Malformed)
        );
    }

    #[test]
    fn a_server_reported_error_settles_only_with_our_state() {
        assert_eq!(
            parse_callback(&callback("error=email_conflict&state=nope"), NONCE),
            Err(Rejection::Refused(Refusal::BadState))
        );
        assert_eq!(
            parse_callback(
                &callback(&format!("error=email_conflict&state={NONCE}")),
                NONCE
            ),
            Ok(Outcome::ServerRefused("email_conflict".into()))
        );
        // As on the loopback callback, the error wins over a code.
        assert_eq!(
            parse_callback(
                &callback(&format!("code=c&error=no_email&state={NONCE}")),
                NONCE
            ),
            Ok(Outcome::ServerRefused("no_email".into()))
        );
    }

    /// First-wins would let an app that prepends a parameter pick the code
    /// (`?code=attacker&code=real&state=…`) or the state.
    #[test]
    fn a_parameter_given_twice_is_malformed() {
        for query in [
            format!("code=attacker&code=real&state={NONCE}"),
            format!("code=c&state={NONCE}&state={NONCE}"),
            format!("code=c&state=nope&state={NONCE}"),
            format!("error=a&error=b&state={NONCE}"),
        ] {
            assert_eq!(
                parse_callback(&callback(&query), NONCE),
                Err(Rejection::Malformed),
                "{query}"
            );
        }
    }

    #[test]
    fn the_mobile_verdict() {
        assert!(verdict(Some(true)).is_ok());
        assert!(verdict(Some(false)).unwrap_err().contains("turned off"));
        assert!(verdict(None)
            .unwrap_err()
            .contains("too old for mobile sign-in"));
    }

    #[test]
    fn a_pending_sign_in_settles_once_and_remembers_refusals() {
        let (mut pending, mut rx) = Pending::new(NONCE);
        assert_eq!(
            pending.check(&callback("code=x&state=nope")),
            Err(Rejection::Refused(Refusal::BadState))
        );
        assert_eq!(pending.last_refusal(), Some(Refusal::BadState));
        assert!(rx.try_recv().is_err(), "a refusal does not settle it");
        let outcome = pending
            .check(&callback(&format!("code=real&state={NONCE}")))
            .unwrap();
        pending.settle(outcome);
        assert_eq!(rx.try_recv().unwrap(), Outcome::Code("real".into()));
    }

    #[test]
    fn dropping_a_pending_sign_in_cancels_its_wait() {
        let (pending, mut rx) = Pending::new(NONCE);
        drop(pending);
        assert_eq!(rx.try_recv(), Err(oneshot::error::TryRecvError::Closed));
    }
}
