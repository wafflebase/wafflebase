//! The server profile: which Wafflebase deployment this app opens.
//!
//! The profile is the deployment's frontend origin, the URL users already
//! visit in a browser. It must be `https://`, or `http://` on a loopback host
//! for local development: the same rule the backend applies before it offers
//! CLI or desktop sign-in, so a profile the picker accepts is one sign-in can
//! work against.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::{Host, Url};

/// Why a URL typed into the server picker was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerUrlError {
    Empty,
    Invalid,
    UnsupportedScheme,
    InsecureRemote,
    Credentials,
}

impl std::fmt::Display for ServerUrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Empty => "Enter the address of your Wafflebase server.",
            Self::Invalid => "That does not look like a web address.",
            Self::UnsupportedScheme => "The address must start with https://.",
            Self::InsecureRemote => {
                "Use https://. Plain http:// works only for localhost, because \
                 sign-in needs a secure connection."
            }
            Self::Credentials => "Remove the user name and password from the address.",
        };
        f.write_str(message)
    }
}

/// Whether a URL host is a loopback literal: `localhost`, `127.0.0.1` or
/// `[::1]`. Other names that happen to resolve to loopback do not count; the
/// backend makes the same distinction.
pub fn is_loopback_host(host: Option<Host<&str>>) -> bool {
    match host {
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip == std::net::Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(ip)) => ip == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    }
}

/// Validate what the person typed and reduce it to an origin.
///
/// A bare host (`wafflebase.example.com`) is read as `https://`. Any path,
/// query or fragment is dropped: the profile is the origin, and the frontend
/// routes from its root.
pub fn parse_server_origin(input: &str) -> Result<Url, ServerUrlError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ServerUrlError::Empty);
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate).map_err(|_| ServerUrlError::Invalid)?;
    match url.scheme() {
        "https" => {}
        "http" => {
            if !is_loopback_host(url.host()) {
                return Err(ServerUrlError::InsecureRemote);
            }
        }
        _ => return Err(ServerUrlError::UnsupportedScheme),
    }
    if url.host().is_none() {
        return Err(ServerUrlError::Invalid);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ServerUrlError::Credentials);
    }
    let origin = url.origin().ascii_serialization();
    Url::parse(&origin).map_err(|_| ServerUrlError::Invalid)
}

/// The origin as people write it: `https://host[:port]`, no trailing slash.
pub fn origin_string(url: &Url) -> String {
    url.origin().ascii_serialization()
}

#[derive(Serialize, Deserialize)]
struct ProfileFile {
    origin: String,
}

/// The saved profile, a small JSON file in the app config directory.
pub struct ServerStore {
    path: PathBuf,
}

impl ServerStore {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join("server.json"),
        }
    }

    /// The saved origin, if there is one and it still validates. A file
    /// edited by hand into something the picker would refuse is ignored, so
    /// the picker runs instead of loading it.
    pub fn load(&self) -> Option<Url> {
        let raw = fs::read_to_string(&self.path).ok()?;
        let profile: ProfileFile = serde_json::from_str(&raw).ok()?;
        parse_server_origin(&profile.origin).ok()
    }

    pub fn save(&self, origin: &Url) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let body = serde_json::to_string_pretty(&ProfileFile {
            origin: origin_string(origin),
        })
        .map_err(io::Error::other)?;
        fs::write(&self.path, body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(input: &str) -> String {
        origin_string(&parse_server_origin(input).expect(input))
    }

    #[test]
    fn accepts_https_and_reduces_to_origin() {
        assert_eq!(ok("https://wafflebase.io"), "https://wafflebase.io");
        assert_eq!(ok("https://wafflebase.io/"), "https://wafflebase.io");
        assert_eq!(
            ok("https://example.com:8443/app/sheets?x=1#frag"),
            "https://example.com:8443"
        );
        assert_eq!(ok("  HTTPS://Example.COM  "), "https://example.com");
    }

    #[test]
    fn bare_host_means_https() {
        assert_eq!(
            ok("wafflebase.example.com"),
            "https://wafflebase.example.com"
        );
        assert_eq!(ok("localhost:5173"), "https://localhost:5173");
    }

    #[test]
    fn http_only_on_loopback() {
        assert_eq!(ok("http://localhost:5173"), "http://localhost:5173");
        assert_eq!(ok("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
        assert_eq!(ok("http://[::1]:5173"), "http://[::1]:5173");
        assert_eq!(
            parse_server_origin("http://wafflebase.io"),
            Err(ServerUrlError::InsecureRemote)
        );
        assert_eq!(
            parse_server_origin("http://192.168.0.10"),
            Err(ServerUrlError::InsecureRemote)
        );
        assert_eq!(
            parse_server_origin("http://localhost.evil.com"),
            Err(ServerUrlError::InsecureRemote)
        );
        assert_eq!(
            parse_server_origin("http://127.0.0.2"),
            Err(ServerUrlError::InsecureRemote)
        );
    }

    #[test]
    fn refuses_other_schemes_and_junk() {
        assert_eq!(parse_server_origin(""), Err(ServerUrlError::Empty));
        assert_eq!(parse_server_origin("   "), Err(ServerUrlError::Empty));
        assert_eq!(
            parse_server_origin("ftp://example.com"),
            Err(ServerUrlError::UnsupportedScheme)
        );
        assert_eq!(
            parse_server_origin("file:///etc/passwd"),
            Err(ServerUrlError::UnsupportedScheme)
        );
        // No `://`, so it is read as a host, and `alert(1)` is no port.
        assert_eq!(
            parse_server_origin("javascript:alert(1)"),
            Err(ServerUrlError::Invalid)
        );
        assert_eq!(
            parse_server_origin("https://"),
            Err(ServerUrlError::Invalid)
        );
        assert_eq!(
            parse_server_origin("https://user:pw@example.com"),
            Err(ServerUrlError::Credentials)
        );
    }

    #[test]
    fn store_round_trips_and_ignores_invalid_files() {
        let dir = std::env::temp_dir().join(format!(
            "wafflebase-desktop-test-{}-{}",
            std::process::id(),
            line!()
        ));
        let store = ServerStore::new(&dir);
        assert!(store.load().is_none());
        let origin = parse_server_origin("https://example.com/path").unwrap();
        store.save(&origin).unwrap();
        assert_eq!(
            store.load().map(|u| origin_string(&u)).as_deref(),
            Some("https://example.com")
        );
        fs::write(
            dir.join("server.json"),
            r#"{"origin":"http://evil.example"}"#,
        )
        .unwrap();
        assert!(store.load().is_none());
        fs::remove_dir_all(&dir).unwrap();
    }
}
