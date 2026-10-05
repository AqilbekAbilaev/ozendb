// Optional SSH tunnel for a connection: open an SSH session to a bastion, bind a
// local TCP port, and forward each accepted socket to the remote MongoDB host
// through an SSH `direct-tcpip` channel. The MongoDB driver then connects to the
// local port. Pure-Rust (russh), runs on the existing tokio runtime.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::client;
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::error::AppError;
use crate::known_hosts::{HostKeyCheck, KnownHostsStore};

/// How long to wait for the user to answer a first-contact host-key prompt
/// before giving up and refusing the connection.
const PROMPT_TIMEOUT_SECS: u64 = 120;

/// How long to wait for the bastion TCP connect and for SSH authentication
/// before failing — otherwise an unreachable/slow host hangs the whole query.
const SSH_CONNECT_TIMEOUT_SECS: u64 = 15;

/// How to authenticate to the SSH server.
pub enum SshAuth {
    Password(String),
    Key {
        path: String,
        passphrase: Option<String>,
    },
}

/// Everything needed to open a tunnel: the bastion + auth, and the MongoDB
/// host/port as reachable *from the bastion*.
pub struct SshParams {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub auth: SshAuth,
    pub mongo_host: String,
    pub mongo_port: u16,
}

/// A live tunnel. Dropping it aborts the accept loop and (when the last clone is
/// gone) closes the SSH session.
pub struct SshTunnel {
    pub local_addr: SocketAddr,
    // Keeps the SSH session alive for the channels' lifetime.
    _session: Arc<client::Handle<ClientHandler>>,
    accept_task: tokio::task::JoinHandle<()>,
    // Cleared when the listener or a forward fails — the pool re-establishes a
    // dead tunnel on next use instead of failing forever.
    alive: Arc<AtomicBool>,
}

impl SshTunnel {
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

/// Pending first-contact host-key prompts awaiting a user decision. The handler
/// registers a prompt and awaits its receiver; the `respond_ssh_host_key`
/// command resolves it with the user's choice.
pub struct HostKeyPrompts {
    pending: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
    next_id: AtomicU64,
}

impl HostKeyPrompts {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// Register a new pending prompt, returning its id and the receiver the
    /// handler awaits.
    fn register(&self) -> (u64, oneshot::Receiver<bool>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        let mut map = match self.pending.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        map.insert(id, sender);
        (id, receiver)
    }

    /// Deliver the user's decision to the waiting handler (called by the
    /// `respond_ssh_host_key` command).
    pub fn resolve(&self, request_id: u64, trust: bool) {
        let mut map = match self.pending.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(sender) = map.remove(&request_id) {
            // The receiver may be gone if the handler already timed out; ignore.
            let _ = sender.send(trust);
        }
    }

    /// Drop a pending prompt without resolving it (timeout or emit failure).
    fn cancel(&self, request_id: u64) {
        let mut map = match self.pending.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        map.remove(&request_id);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyPromptEvent {
    request_id: u64,
    host: String,
    port: u16,
    fingerprint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyChangedEvent {
    host: String,
    port: u16,
    stored_fingerprint: String,
    presented_fingerprint: String,
}

/// Trust-on-first-use host-key policy. A matching key is accepted silently; a
/// brand-new host prompts the user (and is recorded only on approval); a changed
/// key is refused (and the UI is told, so it can warn + offer "forget host").
pub struct ClientHandler {
    known_hosts: Arc<KnownHostsStore>,
    prompts: Arc<HostKeyPrompts>,
    // Emits a UI event; a function rather than the AppHandle itself so the handler (and
    // the tunnel holding its session) needn't be generic over Tauri's runtime.
    emit: Arc<dyn Fn(&str, serde_json::Value) -> Result<(), String> + Send + Sync>,
    host: String,
    port: u16,
    // `check_server_key` can only signal accept/reject via a bool, which loses
    // our descriptive message. We stash the reason here so `establish` can turn
    // the resulting handshake failure into a useful AppError.
    reject_reason: Arc<Mutex<Option<String>>>,
}

impl ClientHandler {
    fn set_reason(&self, reason: String) {
        let mut guard = match self.reject_reason.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = Some(reason);
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        // OpenSSH authorized_keys form ("<algo> <base64>"); both the stored and
        // the presented key are serialized the same way, so string equality is
        // a reliable comparison.
        let presented = match server_public_key.to_openssh() {
            Ok(value) => value,
            Err(e) => {
                self.set_reason(format!("could not read the server's host key: {}", e));
                return Ok(false);
            }
        };
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();

        match self.known_hosts.check(&self.host, self.port, &presented) {
            // Known and unchanged — accept silently.
            HostKeyCheck::Match => Ok(true),

            // First contact — ask the user before trusting (and recording) it.
            HostKeyCheck::Unknown => {
                let (request_id, receiver) = self.prompts.register();
                let event = HostKeyPromptEvent {
                    request_id: request_id,
                    host: self.host.clone(),
                    port: self.port,
                    fingerprint: fingerprint,
                };
                match (self.emit)(crate::events::SSH_HOST_KEY_PROMPT, serde_json::to_value(event).unwrap_or_default()) {
                    Ok(()) => {}
                    Err(e) => {
                        self.prompts.cancel(request_id);
                        self.set_reason(format!("could not show the host-key prompt: {}", e));
                        return Ok(false);
                    }
                }
                // Wait for the user's choice; a closed/ignored dialog must not
                // hang the connection task, so bound the wait.
                let trust = match tokio::time::timeout(
                    std::time::Duration::from_secs(PROMPT_TIMEOUT_SECS),
                    receiver,
                )
                .await
                {
                    Ok(Ok(decision)) => decision,
                    // Sender dropped without a decision — treat as cancel.
                    Ok(Err(_)) => false,
                    // Timed out — clean up the pending entry and refuse.
                    Err(_) => {
                        self.prompts.cancel(request_id);
                        false
                    }
                };
                if trust {
                    match self.known_hosts.record(&self.host, self.port, &presented) {
                        Ok(()) => Ok(true),
                        Err(e) => {
                            let reason = match e {
                                AppError::Ssh(message) => message,
                                other => other.to_string(),
                            };
                            self.set_reason(reason);
                            Ok(false)
                        }
                    }
                } else {
                    self.set_reason(format!(
                        "host key for {}:{} was not trusted — connection cancelled.",
                        self.host, self.port
                    ));
                    Ok(false)
                }
            }

            // The stored key no longer matches — refuse, and tell the UI so it
            // can warn the user and offer to forget the saved key.
            HostKeyCheck::Changed => {
                let stored_fingerprint = match self.known_hosts.stored_key(&self.host, self.port) {
                    Some(stored) => match PublicKey::from_openssh(&stored) {
                        Ok(key) => key.fingerprint(HashAlg::Sha256).to_string(),
                        Err(_) => String::from("unknown"),
                    },
                    None => String::from("unknown"),
                };
                let event = HostKeyChangedEvent {
                    host: self.host.clone(),
                    port: self.port,
                    stored_fingerprint: stored_fingerprint,
                    presented_fingerprint: fingerprint,
                };
                // Best-effort notify; we refuse regardless of whether it lands.
                let _ = (self.emit)(crate::events::SSH_HOST_KEY_CHANGED, serde_json::to_value(event).unwrap_or_default());
                self.set_reason(format!(
                    "host key verification failed for {}:{} — the server's key does not match the \
                     previously trusted key. This may indicate a man-in-the-middle attack, or the \
                     server's key was rotated. Connection refused.",
                    self.host, self.port
                ));
                Ok(false)
            }
        }
    }
}

/// Open an SSH session, authenticate, and start forwarding a fresh local port to
/// `mongo_host:mongo_port` through the tunnel.
pub async fn establish<R: Runtime>(
    params: SshParams,
    known_hosts: Arc<KnownHostsStore>,
    prompts: Arc<HostKeyPrompts>,
    app: AppHandle<R>,
) -> Result<SshTunnel, AppError> {
    let mut config = client::Config::default();
    // Send keepalives so a dropped session is detected instead of hanging.
    config.keepalive_interval = Some(std::time::Duration::from_secs(30));
    let config = Arc::new(config);
    let reject_reason = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        known_hosts: known_hosts,
        prompts: prompts,
        emit: Arc::new(move |name: &str, payload: serde_json::Value| app.emit(name, payload).map_err(|e| e.to_string())),
        host: params.ssh_host.clone(),
        port: params.ssh_port,
        reject_reason: Arc::clone(&reject_reason),
    };
    // Bound the TCP connect ourselves (russh's `connect` has no timeout, so an
    // unreachable bastion would hang the query forever). The SSH handshake then
    // runs on the connected stream — its host-key step keeps its own prompt
    // timeout, so we don't wrap the handshake here.
    let stream = match tokio::time::timeout(
        std::time::Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS),
        TcpStream::connect((params.ssh_host.as_str(), params.ssh_port)),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(e)) => {
            return Err(AppError::Ssh(format!(
                "could not connect to {}:{}: {}",
                params.ssh_host, params.ssh_port, e
            )))
        }
        Err(_) => {
            return Err(AppError::Ssh(format!(
                "timed out connecting to {}:{} — is the host reachable?",
                params.ssh_host, params.ssh_port
            )))
        }
    };
    let mut session = match client::connect_stream(config, stream, handler).await {
        Ok(value) => value,
        Err(e) => {
            // A host-key rejection surfaces here as a generic handshake error;
            // prefer our specific reason when we recorded one.
            let mut guard = match reject_reason.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match guard.take() {
                Some(reason) => return Err(AppError::Ssh(reason)),
                None => return Err(AppError::Ssh(format!("SSH handshake failed: {}", e))),
            }
        }
    };

    let auth_future = match params.auth {
        SshAuth::Password(password) => {
            // Box the two differently-typed futures so they share one timeout below.
            let future = session.authenticate_password(params.ssh_user.clone(), password);
            Box::pin(future) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<russh::client::AuthResult, russh::Error>> + Send>>
        }
        SshAuth::Key { path, passphrase } => {
            let key = match load_secret_key(&path, passphrase.as_deref()) {
                Ok(value) => value,
                Err(e) => return Err(AppError::Ssh(format!("could not load key: {}", e))),
            };
            let future = session.authenticate_publickey(
                params.ssh_user.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(key), None),
            );
            Box::pin(future) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<russh::client::AuthResult, russh::Error>> + Send>>
        }
    };
    let auth = match tokio::time::timeout(
        std::time::Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS),
        auth_future,
    )
    .await
    {
        Ok(value) => value,
        Err(_) => return Err(AppError::Ssh(String::from("timed out during SSH authentication"))),
    };
    match auth {
        Ok(result) => {
            if !result.success() {
                return Err(AppError::Ssh(String::from("authentication failed")));
            }
        }
        Err(e) => return Err(AppError::Ssh(format!("authentication error: {}", e))),
    }

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(value) => value,
        Err(e) => return Err(AppError::Io(e)),
    };
    let local_addr = match listener.local_addr() {
        Ok(value) => value,
        Err(e) => return Err(AppError::Io(e)),
    };

    let session = Arc::new(session);
    let forward_session = Arc::clone(&session);
    let alive = Arc::new(AtomicBool::new(true));
    let accept_alive = Arc::clone(&alive);
    let mongo_host = params.mongo_host;
    let mongo_port = params.mongo_port as u32;
    let local_port = local_addr.port() as u32;

    let accept_task = tokio::spawn(async move {
        loop {
            let (mut socket, _peer) = match listener.accept().await {
                Ok(value) => value,
                Err(_) => {
                    accept_alive.store(false, Ordering::Relaxed);
                    break;
                }
            };
            let session = Arc::clone(&forward_session);
            let forward_alive = Arc::clone(&accept_alive);
            let host = mongo_host.clone();
            tokio::spawn(async move {
                let channel = match session
                    .channel_open_direct_tcpip(host, mongo_port, "127.0.0.1", local_port)
                    .await
                {
                    Ok(value) => value,
                    // A failed channel open usually means the SSH session died.
                    Err(_) => {
                        forward_alive.store(false, Ordering::Relaxed);
                        return;
                    }
                };
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }
    });

    Ok(SshTunnel {
        local_addr: local_addr,
        _session: session,
        accept_task: accept_task,
        alive: alive,
    })
}
