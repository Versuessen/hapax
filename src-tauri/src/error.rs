//! One error type for the whole backend.
//!
//! Every variant renders as a human-readable sentence; on the IPC boundary the
//! error is serialized as `{ "kind": "...", "message": "..." }`, so the
//! frontend can branch on `kind` and show `message` verbatim.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Input that failed validation (the Python `ExplorerError`).
    #[error("{0}")]
    Validation(String),

    /// The remote CQP worker reported a failure or returned malformed output.
    #[error("{0}")]
    Remote(String),

    /// Network / SSH transport problems.
    #[error("{0}")]
    Ssh(String),

    /// The SSH server's host key was rejected or changed.
    #[error("{0}")]
    HostKey(String),

    /// Username/password/key authentication failed.
    #[error("{0}")]
    Auth(String),

    #[error("Not connected. Sign in to the corpus server first.")]
    NotConnected,

    #[error("Another operation is already running")]
    Busy,

    #[error("Request interrupted. If the SSH connection was closed, reconnect before continuing.")]
    Cancelled,

    /// Local file system (exports, notebooks, preferences).
    #[error("{0}")]
    Io(String),

    /// OS credential vault (Windows Credential Manager / Secret Service).
    #[error("{0}")]
    Credential(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validation",
            AppError::Remote(_) => "remote",
            AppError::Ssh(_) => "ssh",
            AppError::HostKey(_) => "host_key",
            AppError::Auth(_) => "auth",
            AppError::NotConnected => "not_connected",
            AppError::Busy => "busy",
            AppError::Cancelled => "cancelled",
            AppError::Io(_) => "io",
            AppError::Credential(_) => "credential",
        }
    }
}

/// Shorthand used throughout the validation code (mirrors `raise ExplorerError(...)`).
pub fn invalid<T>(msg: impl Into<String>) -> Result<T, AppError> {
    Err(AppError::Validation(msg.into()))
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(format!("File system error: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Io(format!("Invalid JSON: {e}"))
    }
}

impl From<csv::Error> for AppError {
    fn from(e: csv::Error) -> Self {
        AppError::Io(format!("CSV error: {e}"))
    }
}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        AppError::Ssh(format!("SSH error: {e}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
