use crate::error::AppError;
use crate::storage::{ConnectionConfig, ConnectionKind};

const TIMEOUT_MS: u64 = 5000;
const TCP_PROBE_SECS: u64 = 3;

/// Percent-encodes a string per RFC 3986, encoding every byte that is not
/// an unreserved character. Handles non-ASCII by encoding each UTF-8 byte.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            b => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Builds a MongoDB connection URI from a stored `ConnectionConfig` plus the
/// password fetched separately from the OS keychain.
/// The resulting URI is suitable for passing to `with_timeout()` and then
/// to `Client::with_uri_str()`.
pub fn build_uri(config: &ConnectionConfig, password: Option<&str>) -> String {
    let scheme = if config.kind() == ConnectionKind::Srv {
        "mongodb+srv"
    } else {
        "mongodb"
    };

    let (creds, has_user) = build_credentials(config, password);

    let host_part = if config.kind() == ConnectionKind::Srv {
        // SRV uses a single hostname and no port; take the first host.
        match config.hosts.first() {
            Some(entry) => entry.host.clone(),
            None => String::from("localhost"),
        }
    } else if config.hosts.is_empty() {
        String::from("localhost:27017")
    } else {
        config
            .hosts
            .iter()
            .map(|entry| format!("{}:{}", entry.host, entry.port))
            .collect::<Vec<String>>()
            .join(",")
    };

    let mut query: Vec<String> = Vec::new();
    push_auth_query(config, has_user, &mut query);

    if let Some(rs) = config.replica_set_name.as_deref().filter(|s| !s.is_empty()) {
        query.push(format!("replicaSet={}", rs));
    }

    push_tls_query(config, &mut query);
    push_options(config, &mut query);

    assemble(scheme, &creds, &host_part, &query)
}

/// Like `build_uri` but targets an explicit `host:port` (used for an SSH tunnel's
/// local forwarded port). Forces a standard `mongodb://` direct connection — no
/// SRV, no replica-set discovery (which would bypass the tunnel) — while keeping
/// the same credentials, auth, and TLS options.
pub fn build_uri_to(
    config: &ConnectionConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
) -> String {
    let (creds, has_user) = build_credentials(config, password);
    let host_part = format!("{}:{}", host, port);

    let mut query: Vec<String> = Vec::new();
    push_auth_query(config, has_user, &mut query);
    query.push(String::from("directConnection=true"));
    push_tls_query(config, &mut query);
    push_options(config, &mut query);

    assemble("mongodb", &creds, &host_part, &query)
}

/// Appends the passthrough `options` (any driver parameter the dedicated fields
/// don't model) to the query string verbatim. Keys are emitted in sorted order
/// (`BTreeMap`), so the built URI is deterministic.
fn push_options(config: &ConnectionConfig, query: &mut Vec<String>) {
    for (key, value) in config.options.iter() {
        if key.is_empty() {
            continue;
        }
        query.push(format!("{}={}", key, value));
    }
}

/// Returns the `user:pass@` prefix (empty when no auth) and whether a user is set.
fn build_credentials(config: &ConnectionConfig, password: Option<&str>) -> (String, bool) {
    // "none" auth mechanism means no credentials in the URI at all.
    let is_no_auth = config.auth_mechanism.as_deref() == Some("none");
    let has_user = !is_no_auth
        && config.username.as_deref().filter(|s| !s.is_empty()).is_some();

    let creds = if has_user {
        let u = percent_encode(config.username.as_deref().unwrap_or(""));
        let p = match password.filter(|s| !s.is_empty()) {
            Some(pw) => format!(":{}", percent_encode(pw)),
            None => String::new(),
        };
        format!("{u}{p}@")
    } else {
        String::new()
    };
    (creds, has_user)
}

fn push_auth_query(config: &ConnectionConfig, has_user: bool, query: &mut Vec<String>) {
    if has_user {
        let auth_db = config.auth_db.as_deref().filter(|s| !s.is_empty()).unwrap_or("admin");
        query.push(format!("authSource={}", auth_db));
    }
    // Explicit mechanism for any mode other than "none" and the implicit default
    // (None / empty = let the driver negotiate). The UI stores short names; map them to
    // the canonical connection-string mechanism the driver expects.
    if let Some(mech) = config.auth_mechanism.as_deref().filter(|s| !s.is_empty() && *s != "none") {
        query.push(format!("authMechanism={}", canonical_mechanism(mech)));
    }
}

/// Map the UI's short auth-mechanism names to the canonical MongoDB connection-string
/// values. Already-canonical or unknown values pass through unchanged, so a future
/// mechanism keeps working without a code change.
fn canonical_mechanism(mech: &str) -> &str {
    match mech {
        "X509" => "MONGODB-X509",
        "AWS" => "MONGODB-AWS",
        "OIDC" => "MONGODB-OIDC",
        other => other,
    }
}

fn push_tls_query(config: &ConnectionConfig, query: &mut Vec<String>) {
    // File paths are percent-encoded; the driver decodes query values.
    if config.tls {
        query.push(String::from("tls=true"));
        if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| !s.is_empty()) {
            query.push(format!("tlsCAFile={}", percent_encode(ca)));
        }
        if let Some(cert) = config.tls_cert_key_file.as_deref().filter(|s| !s.is_empty()) {
            query.push(format!("tlsCertificateKeyFile={}", percent_encode(cert)));
        }
        if config.tls_allow_invalid_certificates {
            query.push(String::from("tlsAllowInvalidCertificates=true"));
        }
    }
}

fn assemble(scheme: &str, creds: &str, host_part: &str, query: &[String]) -> String {
    if query.is_empty() {
        format!("{scheme}://{creds}{host_part}/")
    } else {
        format!("{scheme}://{creds}{host_part}/?{}", query.join("&"))
    }
}

/// Appends MongoDB server-selection and connect timeout query parameters.
/// Handles URIs with and without an existing database path or query string.
///
/// MongoDB requires a '/' before '?', so:
///   mongodb://host:27017          → mongodb://host:27017/?params
///   mongodb://host:27017/db       → mongodb://host:27017/db?params
///   mongodb://host:27017/?foo=1   → mongodb://host:27017/?foo=1&params
pub fn with_timeout(uri: &str) -> String {
    // Only supply our defaults for timeouts the URI doesn't already set, so an
    // explicit value carried over from a pasted URI (or the Advanced tab) wins.
    let mut additions: Vec<String> = Vec::new();
    if !uri.contains("serverSelectionTimeoutMS") {
        additions.push(format!("serverSelectionTimeoutMS={TIMEOUT_MS}"));
    }
    if !uri.contains("connectTimeoutMS") {
        additions.push(format!("connectTimeoutMS={TIMEOUT_MS}"));
    }
    if additions.is_empty() {
        return uri.to_string();
    }
    let params = additions.join("&");
    if uri.contains('?') {
        format!("{uri}&{params}")
    } else {
        let scheme_end = uri.find("://").map(|i| i + 3).unwrap_or(0);
        let has_path = uri[scheme_end..].contains('/');
        if has_path {
            format!("{uri}?{params}")
        } else {
            format!("{uri}/?{params}")
        }
    }
}

/// Extracts "host:port" from a standard `mongodb://` URI for the TCP probe.
/// Returns `None` for `mongodb+srv://` or URIs we cannot parse safely.
pub fn extract_host_port(uri: &str) -> Option<String> {
    let rest = match uri.strip_prefix("mongodb://") {
        Some(val) => val,
        None => return None,
    };
    // Drop credentials (user:pass@host → host)
    let rest = rest.find('@').map_or(rest, |i| &rest[i + 1..]);
    // Take the host section before any '/' or '?'
    let hosts = match rest.split(|c: char| c == '/' || c == '?').next() {
        Some(val) => val,
        None => return None,
    };
    // A multi-host seed list — probe just the first host.
    let host_port = match hosts.split(',').next() {
        Some(val) => val,
        None => return None,
    };
    if host_port.is_empty() {
        return None;
    }
    if host_port.contains(':') {
        Some(host_port.to_string())
    } else {
        Some(format!("{host_port}:27017"))
    }
}

/// Performs an async TCP probe against the first host in the URI.
/// Returns immediately on ECONNREFUSED (port closed); times out after 3 s
/// for unreachable hosts (firewall, wrong IP, etc.).
/// No-op for `mongodb+srv://` or URIs we cannot parse.
pub async fn tcp_probe(uri: &str) -> Result<(), AppError> {
    let host_port = match extract_host_port(uri) {
        Some(val) => val,
        None => return Ok(()),
    };

    let addrs: Vec<_> = match tokio::net::lookup_host(&host_port).await {
        Ok(val) => val.collect(),
        Err(e) => return Err(AppError::Unreachable {
            address: host_port.clone(),
            reason: e.to_string(),
        }),
    };

    if addrs.is_empty() {
        return Ok(());
    }

    // Try every resolved address (e.g. ::1 and 127.0.0.1 for "localhost").
    // Succeed as soon as any one connects; only fail if all are refused/timeout.
    let mut last_err = String::new();
    for addr in &addrs {
        match tokio::time::timeout(
            std::time::Duration::from_secs(TCP_PROBE_SECS),
            tokio::net::TcpStream::connect(addr),
        )
        .await
        {
            Ok(Ok(_)) => return Ok(()),
            Ok(Err(e)) => last_err = e.to_string(),
            Err(_) => last_err = format!("timed out connecting to {addr}"),
        }
    }

    Err(AppError::Unreachable {
        address: host_port,
        reason: last_err,
    })
}

#[cfg(test)]
#[path = "uri.test.rs"]
mod tests;
