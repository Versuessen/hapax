//! Local state: preferences.json (same file and schema as the Python v3 app)
//! and the OS credential vault.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

pub const SERVICE: &str = "Hapax SSH";
/// Vault service name used before the rename; read once and migrated.
const LEGACY_SERVICE: &str = "CQP Corpus Explorer SSH";
/// Data folder name used before the rename (and by the Python v3 app).
const LEGACY_DIR: &str = "CQPExplorer";
pub const DEFAULT_HOST: &str = "login.fu-berlin.de";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/// Windows: %LOCALAPPDATA%\Hapax   Linux: ~/.local/share/Hapax
///
/// On first use, files from the pre-rename folder (`CQPExplorer`, shared with
/// the Python v3 app) are copied across, so saved searches carry over. The old
/// folder is left untouched.
pub fn state_dir() -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| AppError::Io("Cannot determine the local application data folder".into()))?;
    let dir = base.join("Hapax");
    migrate_legacy_dir(&base.join(LEGACY_DIR), &dir);
    Ok(dir)
}

fn migrate_legacy_dir(old: &std::path::Path, new: &std::path::Path) {
    if new.exists() || !old.is_dir() {
        return;
    }
    if std::fs::create_dir_all(new).is_err() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(old) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                let _ = std::fs::copy(&p, new.join(e.file_name()));
            }
        }
    }
}

pub fn prefs_path() -> AppResult<PathBuf> {
    Ok(state_dir()?.join("preferences.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSearch {
    pub name: String,
    /// Kept as loose JSON: v3 stored the whole request dict (incl. op/offset).
    pub query: Value,
}

/// A named set of document filters for one corpus (metadata differs between corpora).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FilterPreset {
    pub name: String,
    pub filters: Vec<crate::query::MetaFilter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub user: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_corpus")]
    pub corpus: String,
    #[serde(default)]
    pub saved_searches: Vec<SavedSearch>,
    #[serde(default = "default_zoom")]
    pub zoom_percent: u32,
    /// Filter presets keyed by corpus id. Absent in older files; empty maps are not written.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub filter_presets: std::collections::BTreeMap<String, Vec<FilterPreset>>,
    /// Unknown keys are preserved on save (forward compatibility with Phase 2 UI settings).
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_host() -> String { DEFAULT_HOST.into() }
fn default_port() -> u16 { 22 }
fn default_corpus() -> String { "BROWN-LEGACY".into() }
fn default_zoom() -> u32 { 100 }

impl Default for Preferences {
    fn default() -> Self {
        serde_json::from_value(Value::Object(Map::new())).expect("defaults deserialize")
    }
}

/// Never fails: an unreadable or corrupt file yields defaults (like `load_prefs`).
pub fn load_prefs() -> Preferences {
    prefs_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Atomic write: stage to .tmp, then rename over the real file.
pub fn save_prefs(p: &Preferences) -> AppResult<()> {
    let path = prefs_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let staged = path.with_extension("tmp");
    std::fs::write(&staged, serde_json::to_string_pretty(p)?)?;
    std::fs::rename(&staged, &path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Credentials (Windows Credential Manager / Secret Service via KWallet)
// ---------------------------------------------------------------------------

pub fn credential_key(host: &str, user: &str, port: u16) -> String {
    format!("{user}@{}:{port}", host.to_lowercase())
}

fn entry(host: &str, user: &str, port: u16) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, &credential_key(host, user, port))
        .map_err(|e| AppError::Credential(format!("Credential vault unavailable: {e}")))
}

/// `None` when nothing is stored (or the vault is unavailable — connect then
/// simply asks for a password, exactly like the Python app).
pub fn get_password(host: &str, user: &str, port: u16) -> Option<String> {
    if let Some(p) = entry(host, user, port).ok().and_then(|e| e.get_password().ok()) {
        return Some(p);
    }
    // Pre-rename vault entry: move it to the new service name once.
    let legacy = keyring::Entry::new(LEGACY_SERVICE, &credential_key(host, user, port)).ok()?;
    let p = legacy.get_password().ok()?;
    if set_password(host, user, port, &p).is_ok() {
        let _ = legacy.delete_credential();
    }
    Some(p)
}

pub fn set_password(host: &str, user: &str, port: u16, password: &str) -> AppResult<()> {
    entry(host, user, port)?
        .set_password(password)
        .map_err(|e| AppError::Credential(format!("Password not saved: {e}")))
}

pub fn delete_password(host: &str, user: &str, port: u16) -> AppResult<bool> {
    match entry(host, user, port)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Credential(format!("Could not delete saved credential: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v3_preferences_file_is_compatible() {
        let v3 = r#"{"host":"login.fu-berlin.de","user":"jdoe","corpus":"BNC",
            "saved_searches":[{"name":"x","query":{"op":"search","corpus":"BNC","value":"go"}}],
            "zoom_percent":110,"future_key":true}"#;
        let p: Preferences = serde_json::from_str(v3).unwrap();
        assert_eq!(p.port, 22);
        assert_eq!(p.saved_searches.len(), 1);
        let back = serde_json::to_value(&p).unwrap();
        assert_eq!(back["future_key"], true);
        assert!(p.filter_presets.is_empty());
        assert!(back.get("filter_presets").is_none(), "older files stay as they were until a preset is saved");
        assert_eq!(Preferences::default().host, DEFAULT_HOST);
    }

    #[test]
    fn legacy_folder_is_copied_once() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("CQPExplorer"), t.path().join("Hapax"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("preferences.json"), "{}").unwrap();
        migrate_legacy_dir(&old, &new);
        assert!(new.join("preferences.json").exists());
        std::fs::write(new.join("preferences.json"), "{\"user\":\"x\"}").unwrap();
        migrate_legacy_dir(&old, &new); // no overwrite on later starts
        assert!(std::fs::read_to_string(new.join("preferences.json")).unwrap().contains("x"));
    }

    #[test]
    fn credential_key_format() {
        assert_eq!(credential_key("Login.FU-Berlin.de", "jdoe", 22), "jdoe@login.fu-berlin.de:22");
    }
}
