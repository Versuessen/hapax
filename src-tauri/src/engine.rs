//! Shared application state and the single "run one remote operation" path.
//!
//! Mirrors the v3 GUI's concurrency rules: one SSH session, one operation at
//! a time (`busy`), a Stop button that closes the active channel, and a small
//! in-memory cache of result pages that is cleared on connect/disconnect.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use crate::storage::{self, Preferences};

const CACHE_CAPACITY: usize = 16;

/// Every remote result is wrapped with timing info (the v3 footer "1.23 s · cached").
#[derive(Debug, Clone, Serialize)]
pub struct Timed<T: Serialize> {
    pub data: T,
    pub elapsed_seconds: f64,
    pub cached: bool,
}

#[derive(Default)]
struct RequestCache {
    order: VecDeque<String>,
    map: HashMap<String, String>,
}

impl RequestCache {
    fn get(&self, k: &str) -> Option<String> {
        self.map.get(k).cloned()
    }
    fn put(&mut self, k: String, v: String) {
        if self.map.contains_key(&k) {
            return;
        }
        if self.order.len() >= CACHE_CAPACITY {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
        self.order.push_back(k.clone());
        self.map.insert(k, v);
    }
    fn clear(&mut self) {
        self.order.clear();
        self.map.clear();
    }
}

pub type PendingHostKeys = Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

pub struct AppState {
    session: tokio::sync::Mutex<Option<Arc<SshSession>>>,
    busy: AtomicBool,
    cancel: Mutex<CancellationToken>,
    cache: Mutex<RequestCache>,
    pub pending_host_keys: PendingHostKeys,
    pub prefs: Mutex<Preferences>,
    pub last_elapsed: Mutex<Option<f64>>,
    pub console: crate::console::ConsoleLog,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session: tokio::sync::Mutex::new(None),
            busy: AtomicBool::new(false),
            cancel: Mutex::new(CancellationToken::new()),
            cache: Mutex::new(RequestCache::default()),
            pending_host_keys: Arc::new(Mutex::new(HashMap::new())),
            prefs: Mutex::new(storage::load_prefs()),
            last_elapsed: Mutex::new(None),
            console: Default::default(),
        }
    }
}

/// RAII flag for "an operation is running".
pub struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl AppState {
    pub fn begin(&self) -> AppResult<(BusyGuard<'_>, CancellationToken)> {
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err(AppError::Busy);
        }
        let token = CancellationToken::new();
        *lock(&self.cancel) = token.clone();
        Ok((BusyGuard(&self.busy), token))
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    pub fn cancel_current(&self) {
        lock(&self.cancel).cancel();
    }

    pub fn clear_cache(&self) {
        lock(&self.cache).clear();
    }

    pub async fn session(&self) -> Option<Arc<SshSession>> {
        self.session.lock().await.clone()
    }

    pub async fn set_session(&self, s: Option<Arc<SshSession>>) -> Option<Arc<SshSession>> {
        std::mem::replace(&mut *self.session.lock().await, s)
    }

    /// Run one worker request. `cacheable` mirrors v3 `_cached_run` (search pages
    /// and workflow result/sample pages only).
    pub async fn execute(&self, payload: &Value, cacheable: bool) -> AppResult<(String, f64, bool)> {
        let started = Instant::now();
        let key = serde_json::to_string(payload)?;
        if cacheable {
            if let Some(hit) = lock(&self.cache).get(&key) {
                let elapsed = started.elapsed().as_secs_f64();
                *lock(&self.last_elapsed) = Some(elapsed);
                let id = self.console.begin_request(payload, true);
                self.console.finish_ok(id, &hit, "", elapsed, true);
                return Ok((hit, elapsed, true));
            }
        }
        let session = self.session().await.ok_or(AppError::NotConnected)?;
        if !session.is_connected() {
            return Err(AppError::NotConnected);
        }
        let (_guard, token) = self.begin()?;
        let id = self.console.begin_request(payload, false);
        let out = match session.run_worker_full(payload, &token).await {
            Ok(o) => o,
            Err(e) => {
                self.console.finish_err(id, &e, started.elapsed().as_secs_f64());
                return Err(e);
            }
        };
        let elapsed = started.elapsed().as_secs_f64();
        self.console.finish_ok(id, &out.stdout, &out.stderr, elapsed, false);
        if cacheable {
            lock(&self.cache).put(key, out.stdout.clone());
        }
        *lock(&self.last_elapsed) = Some(elapsed);
        Ok((out.stdout, elapsed, false))
    }

    pub fn last_elapsed(&self) -> Option<f64> {
        *lock(&self.last_elapsed)
    }

    pub fn prefs_snapshot(&self) -> Preferences {
        lock(&self.prefs).clone()
    }

    pub fn update_prefs(&self, f: impl FnOnce(&mut Preferences)) -> AppResult<Preferences> {
        let mut p = lock(&self.prefs);
        f(&mut p);
        storage::save_prefs(&p)?;
        Ok(p.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_is_bounded_fifo() {
        let mut c = RequestCache::default();
        for i in 0..20 {
            c.put(i.to_string(), i.to_string());
        }
        assert_eq!(c.map.len(), CACHE_CAPACITY);
        assert!(c.get("0").is_none());
        assert_eq!(c.get("19").as_deref(), Some("19"));
    }

    #[test]
    fn busy_flag_serializes_operations() {
        let s = AppState::default();
        let g = s.begin().unwrap();
        assert!(matches!(s.begin(), Err(AppError::Busy)));
        drop(g);
        assert!(s.begin().is_ok());
    }
}
