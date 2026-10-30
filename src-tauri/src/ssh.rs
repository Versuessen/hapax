//! Pure-Rust SSH transport (replaces the paramiko `SSHConnection` class).
//!
//! Lifecycle, identical to v3:
//!   1. TCP connect (12 s) → key exchange → host-key check against
//!      `~/.ssh/known_hosts`. Unknown keys are shown to the user through an
//!      async callback (the GUI prompt); a *changed* key is always refused.
//!   2. Password auth, falling back to keyboard-interactive with the same
//!      password (paramiko's `fallback=True` behaviour), or — when no password
//!      is supplied — the default unencrypted key files in `~/.ssh`.
//!   3. Each operation opens one exec channel running
//!      `python3 -c '<remote worker>'`, writes the JSON request to stdin,
//!      closes stdin, and collects stdout/stderr/exit status.
//!   4. "Stop request" closes the active channel (best effort, same caveat as v3:
//!      the server-side process is not guaranteed to be killed immediately).

use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect, MethodKind};
use serde::Serialize;
use serde_json::Value;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

/// Executed on the university server only. Unchanged from cqp_core.py.
pub const REMOTE_WORKER: &str = include_str!("../remote/worker.py");

const TCP_TIMEOUT: Duration = Duration::from_secs(12);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(150); // includes up to 120 s host-key prompt
const AUTH_TIMEOUT: Duration = Duration::from_secs(18);
const CHANNEL_TIMEOUT: Duration = Duration::from_secs(20);
/// Like paramiko's `exec_command(timeout=100)`: maximum silence between packets.
const READ_STALL_TIMEOUT: Duration = Duration::from_secs(100);
const MAX_RESPONSE_BYTES: usize = 8_500_000;
const MAX_STDERR_BYTES: usize = 64 * 1024;

/// Sent to the GUI when the server presents a key not yet in known_hosts.
#[derive(Debug, Clone, Serialize)]
pub struct HostKeyPrompt {
    pub request_id: String,
    pub host: String,
    pub port: u16,
    pub key_type: String,
    /// `SHA256:…` — same format as `ssh-keygen -lf` and the v3 dialog.
    pub fingerprint: String,
    pub known_hosts_path: String,
}

pub type TrustDecider =
    Arc<dyn Fn(HostKeyPrompt) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

pub fn known_hosts_path() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".ssh").join("known_hosts"))
        .ok_or_else(|| AppError::HostKey("Cannot locate your home folder for known_hosts".into()))
}

pub struct ClientHandler {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    decide: TrustDecider,
    /// Why the key was refused (russh itself only reports `UnknownKey`).
    rejection: Arc<Mutex<Option<AppError>>>,
}

impl ClientHandler {
    fn reject(&self, err: AppError) -> Result<bool, russh::Error> {
        *self.rejection.lock().unwrap_or_else(|p| p.into_inner()) = Some(err);
        Ok(false)
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, presented: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let key = match presented {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(_) => {
                return self.reject(AppError::HostKey(
                    "The server presented an SSH host certificate; only plain host keys are supported".into(),
                ))
            }
        };
        match check_known_hosts_path(&self.host, self.port, &key, &self.known_hosts) {
            Ok(true) => Ok(true),
            Ok(false) => {
                let prompt = HostKeyPrompt {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    host: self.host.clone(),
                    port: self.port,
                    key_type: key.algorithm().as_str().to_string(),
                    fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
                    known_hosts_path: self.known_hosts.display().to_string(),
                };
                if !(self.decide)(prompt).await {
                    return self.reject(AppError::HostKey("SSH server key was not trusted".into()));
                }
                // Persist only the explicitly accepted key; never rewrite other lines.
                if let Err(e) = learn_known_hosts_path(&self.host, self.port, &key, &self.known_hosts) {
                    return self.reject(AppError::HostKey(format!("Could not record the trusted host key: {e}")));
                }
                Ok(true)
            }
            Err(russh::keys::Error::KeyChanged { line }) => self.reject(AppError::HostKey(format!(
                "The SSH host key for {} has CHANGED (known_hosts line {line}). This can indicate a \
                 man-in-the-middle attack. The connection was refused. Verify the new fingerprint with \
                 the university before editing {}.",
                self.host,
                self.known_hosts.display()
            ))),
            Err(e) => self.reject(AppError::HostKey(format!("Cannot read known_hosts: {e}"))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub password: Option<String>,
}

pub fn validate_target(host: &str, user: &str, port: u16) -> AppResult<()> {
    let host_ok = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let user_ok = !user.is_empty() && user.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
    if !host_ok || !user_ok {
        return Err(AppError::Validation("Invalid SSH hostname or username".into()));
    }
    if port == 0 {
        return Err(AppError::Validation("Invalid SSH port".into()));
    }
    Ok(())
}

/// POSIX `shlex.quote`.
pub fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_".contains(c)) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

pub struct WorkerOutput {
    pub stdout: String,
    pub stderr: String,
}

pub struct SshSession {
    handle: Handle<ClientHandler>,
    pub host: String,
    pub user: String,
    pub port: u16,
}

impl SshSession {
    pub async fn connect(params: ConnectParams, decide: TrustDecider) -> AppResult<Self> {
        validate_target(&params.host, &params.user, params.port)?;
        let rejection = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            host: params.host.clone(),
            port: params.port,
            known_hosts: known_hosts_path()?,
            decide,
            rejection: rejection.clone(),
        };
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 4,
            inactivity_timeout: None,
            nodelay: true,
            ..Default::default()
        });

        let stream = match timeout(TCP_TIMEOUT, tokio::net::TcpStream::connect((params.host.as_str(), params.port))).await {
            Err(_) => return Err(AppError::Ssh(format!("Timed out connecting to {}:{}", params.host, params.port))),
            Ok(Err(e)) => return Err(AppError::Ssh(format!("Cannot reach {}:{} — {e}", params.host, params.port))),
            Ok(Ok(s)) => s,
        };
        let _ = stream.set_nodelay(true);

        let mut handle = match timeout(HANDSHAKE_TIMEOUT, client::connect_stream(config, stream, handler)).await {
            Err(_) => return Err(AppError::Ssh("SSH handshake timed out".into())),
            Ok(Err(e)) => {
                if let Some(reason) = rejection.lock().unwrap_or_else(|p| p.into_inner()).take() {
                    return Err(reason);
                }
                return Err(AppError::Ssh(format!("SSH handshake failed: {e}")));
            }
            Ok(Ok(h)) => h,
        };

        let authed = match params.password.as_deref().filter(|p| !p.is_empty()) {
            Some(pw) => auth_password(&mut handle, &params.user, pw).await,
            None => auth_default_keys(&mut handle, &params.user).await,
        };
        if let Err(e) = authed {
            let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
            return Err(e);
        }
        Ok(Self { handle, host: params.host, user: params.user, port: params.port })
    }

    pub fn is_connected(&self) -> bool {
        !self.handle.is_closed()
    }

    pub async fn close(&self) {
        let _ = self.handle.disconnect(Disconnect::ByApplication, "", "en").await;
    }

    /// Run the remote worker with one JSON request; returns its stdout.
    pub async fn run_worker(&self, payload: &Value, cancel: &CancellationToken) -> AppResult<String> {
        self.run_worker_full(payload, cancel).await.map(|o| o.stdout)
    }

    /// Like `run_worker`, but also returns stderr (for the request console).
    pub async fn run_worker_full(&self, payload: &Value, cancel: &CancellationToken) -> AppResult<WorkerOutput> {
        if !self.is_connected() {
            return Err(AppError::NotConnected);
        }
        let command = format!("python3 -c {}", shell_quote(REMOTE_WORKER));
        let body = serde_json::to_vec(payload)?;

        let mut channel = match timeout(CHANNEL_TIMEOUT, self.handle.channel_open_session()).await {
            Err(_) => return Err(AppError::Ssh("Timed out opening an SSH channel".into())),
            Ok(r) => r.map_err(|e| AppError::Ssh(format!("Cannot open SSH channel: {e}")))?,
        };
        channel.exec(true, command).await?;
        channel.data(&body[..]).await?;
        channel.eof().await?;

        let mut stdout: Vec<u8> = Vec::new();
        let mut stderr: Vec<u8> = Vec::new();
        let mut exit_status: Option<u32> = None;
        loop {
            let msg = tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = channel.close().await;
                    return Err(AppError::Cancelled);
                }
                m = timeout(READ_STALL_TIMEOUT, channel.wait()) => m,
            };
            let msg = match msg {
                Err(_) => {
                    let _ = channel.close().await;
                    return Err(AppError::Ssh("The server stopped responding (100 s without data)".into()));
                }
                Ok(None) => break,
                Ok(Some(m)) => m,
            };
            match msg {
                ChannelMsg::Data { data } => {
                    stdout.extend_from_slice(&data);
                    if stdout.len() > MAX_RESPONSE_BYTES {
                        let _ = channel.close().await;
                        return Err(AppError::Remote("Server response exceeded the local safety limit".into()));
                    }
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    if stderr.len() < MAX_STDERR_BYTES {
                        stderr.extend_from_slice(&data);
                    }
                }
                ChannelMsg::ExitStatus { exit_status: s } => exit_status = Some(s),
                ChannelMsg::Failure => {
                    let _ = channel.close().await;
                    return Err(AppError::Remote("The server refused to run the remote CQP worker".into()));
                }
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        let out = String::from_utf8_lossy(&stdout).into_owned();
        if exit_status != Some(0) {
            let err = String::from_utf8_lossy(&stderr);
            let detail = if err.trim().is_empty() { out.as_str() } else { err.as_ref() };
            let tail: String = {
                let chars: Vec<char> = detail.chars().collect();
                chars[chars.len().saturating_sub(600)..].iter().collect()
            };
            return Err(AppError::Remote(format!("Remote execution failed: {tail}")));
        }
        Ok(WorkerOutput { stdout: out, stderr: String::from_utf8_lossy(&stderr).into_owned() })
    }
}

async fn auth_password(handle: &mut Handle<ClientHandler>, user: &str, password: &str) -> AppResult<()> {
    let first = timeout(AUTH_TIMEOUT, handle.authenticate_password(user, password))
        .await
        .map_err(|_| AppError::Auth("Authentication timed out".into()))??;
    let remaining = match first {
        russh::client::AuthResult::Success => return Ok(()),
        russh::client::AuthResult::Failure { remaining_methods, .. } => remaining_methods,
    };
    if !remaining.contains(&MethodKind::KeyboardInteractive) {
        return Err(AppError::Auth("Authentication failed: check username and password".into()));
    }
    // paramiko fallback: answer a single prompt with the password.
    let mut reply = timeout(AUTH_TIMEOUT, handle.authenticate_keyboard_interactive_start(user, None::<String>))
        .await
        .map_err(|_| AppError::Auth("Authentication timed out".into()))??;
    for _round in 0..5 {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => break,
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                if prompts.len() > 1 {
                    return Err(AppError::Auth(
                        "The server asked for more than a password (e.g. a second factor), which this app does not support yet".into(),
                    ));
                }
                let answers = prompts.iter().map(|_| password.to_string()).collect();
                reply = timeout(AUTH_TIMEOUT, handle.authenticate_keyboard_interactive_respond(answers))
                    .await
                    .map_err(|_| AppError::Auth("Authentication timed out".into()))??;
            }
        }
    }
    Err(AppError::Auth("Authentication failed: check username and password".into()))
}

/// No password given: try the standard unencrypted key files (paramiko `look_for_keys`).
async fn auth_default_keys(handle: &mut Handle<ClientHandler>, user: &str) -> AppResult<()> {
    let Some(ssh_dir) = dirs::home_dir().map(|h| h.join(".ssh")) else {
        return Err(AppError::Auth("Enter your SSH password".into()));
    };
    let rsa_hash = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
    let mut tried = false;
    for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
        let path = ssh_dir.join(name);
        let Ok(key) = russh::keys::load_secret_key(&path, None) else { continue };
        tried = true;
        let key = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
        let r = timeout(AUTH_TIMEOUT, handle.authenticate_publickey(user, key))
            .await
            .map_err(|_| AppError::Auth("Authentication timed out".into()))??;
        if r.success() {
            return Ok(());
        }
    }
    Err(AppError::Auth(if tried {
        "Your SSH keys were rejected. Enter your SSH password.".into()
    } else {
        "Enter your SSH password (no saved password or SSH key was found)".into()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_matches_shlex() {
        assert_eq!(shell_quote("abc"), "abc");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\"'\"'s'");
        assert!(shell_quote(REMOTE_WORKER).starts_with('\''));
    }

    #[test]
    fn target_validation() {
        assert!(validate_target("login.fu-berlin.de", "jdoe", 22).is_ok());
        assert!(validate_target("evil;rm", "jdoe", 22).is_err());
        assert!(validate_target("host", "j doe", 22).is_err());
        assert!(validate_target("host", "jdoe", 0).is_err());
    }
}
