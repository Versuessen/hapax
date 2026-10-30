//! In-memory request console: every command sent to the server and what came back.
//!
//! Each remote operation produces one entry with:
//!   - the request JSON written to the worker's stdin,
//!   - the SSH exec line (`python3 -c '<remote worker>'`),
//!   - the CQP / CWB commands the remote worker issues for that request
//!     (derived deterministically from the request, mirroring remote/worker.py),
//!   - the raw stdout (and stderr) that came back, timing and status.
//! Connection events (connect, host key decisions, disconnect, stop) are logged
//! too. Passwords are never recorded. Nothing is written to disk unless the user
//! exports the log.

use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::corpora::CWB_REGISTRY;

pub const CONSOLE_EVENT: &str = "console://entry";
const CAPACITY: usize = 300;
const MAX_TEXT: usize = 64 * 1024;
const CWB_BIN: &str = "/home/s/structeng/cwb/bin";

#[derive(Debug, Clone, Serialize)]
pub struct ConsoleEntry {
    pub id: u64,
    /// UTC, RFC 3339.
    pub at: String,
    /// "request" | "event"
    pub kind: String,
    /// Worker op (search, workflow, …) or event name (connect, host_key, …).
    pub op: String,
    /// "pending" | "ok" | "error" | "cancelled" | "cached" | "info"
    pub status: String,
    pub summary: String,
    /// SSH exec line actually run on the server.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exec: Option<String>,
    /// CQP / CWB commands the remote worker runs for this request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<String>,
    /// JSON written to the worker's stdin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<Value>,
    /// Raw stdout returned (truncated to 64 KB in the log).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,
    pub response_bytes: usize,
    pub response_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_seconds: Option<f64>,
}

#[derive(Default)]
pub struct ConsoleLog {
    entries: Mutex<VecDeque<ConsoleEntry>>,
    next: AtomicU64,
    app: OnceLock<AppHandle>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn clip(s: &str) -> (String, bool) {
    if s.len() <= MAX_TEXT {
        return (s.to_string(), false);
    }
    let mut end = MAX_TEXT;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

impl ConsoleLog {
    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    fn emit(&self, e: &ConsoleEntry) {
        if let Some(app) = self.app.get() {
            let _ = app.emit(CONSOLE_EVENT, e);
        }
    }

    fn push(&self, mut e: ConsoleEntry) -> u64 {
        e.id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut q = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            if q.len() >= CAPACITY {
                q.pop_front();
            }
            q.push_back(e.clone());
        }
        self.emit(&e);
        e.id
    }

    fn update(&self, id: u64, f: impl FnOnce(&mut ConsoleEntry)) {
        let updated = {
            let mut q = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            q.iter_mut().find(|e| e.id == id).map(|e| {
                f(e);
                e.clone()
            })
        };
        if let Some(e) = updated {
            self.emit(&e);
        }
    }

    pub fn snapshot(&self) -> Vec<ConsoleEntry> {
        self.entries.lock().unwrap_or_else(|p| p.into_inner()).iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.entries.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }

    /// Log a connection-level event (no secrets).
    pub fn event(&self, op: &str, status: &str, summary: impl Into<String>) {
        self.push(ConsoleEntry {
            id: 0,
            at: now(),
            kind: "event".into(),
            op: op.into(),
            status: status.into(),
            summary: summary.into(),
            exec: None,
            commands: None,
            request: None,
            response: None,
            response_bytes: 0,
            response_truncated: false,
            stderr: None,
            error: None,
            elapsed_seconds: None,
        });
    }

    /// Start a request entry; returns its id for `finish_*`.
    pub fn begin_request(&self, payload: &Value, cached: bool) -> u64 {
        let op = payload["op"].as_str().unwrap_or("?").to_string();
        self.push(ConsoleEntry {
            id: 0,
            at: now(),
            kind: "request".into(),
            op: op.clone(),
            status: if cached { "cached".into() } else { "pending".into() },
            summary: summarize(payload),
            exec: Some("python3 -c '<remote worker, remote/worker.py>'   # request JSON on stdin".into()),
            commands: Some(cqp_commands(payload)),
            request: Some(payload.clone()),
            response: None,
            response_bytes: 0,
            response_truncated: false,
            stderr: None,
            error: None,
            elapsed_seconds: None,
        })
    }

    pub fn finish_ok(&self, id: u64, stdout: &str, stderr: &str, elapsed: f64, cached: bool) {
        let (resp, truncated) = clip(&pretty(stdout));
        let (err, _) = clip(stderr);
        let bytes = stdout.len();
        self.update(id, |e| {
            e.status = if cached { "cached".into() } else { "ok".into() };
            e.response = Some(resp);
            e.response_bytes = bytes;
            e.response_truncated = truncated;
            e.stderr = (!err.trim().is_empty()).then_some(err);
            e.elapsed_seconds = Some(elapsed);
        });
    }

    pub fn finish_err(&self, id: u64, error: &crate::error::AppError, elapsed: f64) {
        let cancelled = matches!(error, crate::error::AppError::Cancelled);
        let msg = error.to_string();
        self.update(id, |e| {
            e.status = if cancelled { "cancelled".into() } else { "error".into() };
            e.error = Some(msg);
            e.elapsed_seconds = Some(elapsed);
        });
    }
}

/// Pretty-print JSON stdout for reading; fall back to the raw text.
fn pretty(stdout: &str) -> String {
    serde_json::from_str::<Value>(stdout.trim())
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| stdout.to_string())
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn n(v: &Value, k: &str) -> i64 {
    v[k].as_i64().unwrap_or(0)
}

pub fn summarize(p: &Value) -> String {
    match s(p, "op") {
        "health" => "Health check: CQP version".into(),
        "search" | "export" => format!("{} · {} · rows {}–{}{}", s(p, "corpus"), s(p, "expression"), n(p, "offset") + 1, n(p, "offset") + n(p, "limit"), if s(p, "sort").is_empty() { String::new() } else { format!(" · sorted by {}", s(p, "sort")) }),
        "frequencies" => format!("{} · {} · group by {} at {}", s(p, "corpus"), s(p, "expression"), s(p, "group_field"), s(p, "group_anchor")),
        "collocates" => format!("{} · {} · first {} matches", s(p, "corpus"), s(p, "expression"), n(p, "sample_limit")),
        "compare" => format!("compare {} in {}", s(p, "value"), p["corpora"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" vs ")).unwrap_or_default()),
        "lexicon" => format!("{} · all values of {}", s(p, "corpus"), s(p, "field")),
        "metadata" => format!("{} · values of {}", s(p, "corpus"), s(p, "attribute")),
        "distribution" => format!("{} · {} · across {}", s(p, "corpus"), s(p, "expression"), s(p, "attribute")),
        "registry" => "List corpora in the server registry".into(),
        "syntax" => format!("EFCAM · sentence at token {}", n(p, "position")),
        "workflow" => format!("{} · {} steps · mode {}", s(&p["plan"], "corpus"), p["plan"]["steps"].as_array().map(|a| a.len()).unwrap_or(0), s(p, "mode")),
        other => other.to_string(),
    }
}

fn tabulate_spec(p: &Value) -> String {
    let ctx = n(p, "context").max(1);
    let mut spec = format!("match, matchend, match[-{ctx}]..match[-1] word, match..matchend word, matchend[1]..matchend[{ctx}] word");
    if let Some(src) = p["source_attribute"].as_str() {
        spec.push_str(&format!(", match {src}"));
    }
    spec
}

/// The CQP/CWB commands the remote worker runs for this request
/// (mirrors remote/worker.py; `cqp` = `{CWB_BIN}/cqp -c -p -r {CWB_REGISTRY}`).
pub fn cqp_commands(p: &Value) -> String {
    let cqp = format!("{CWB_BIN}/cqp -c -p -r {CWB_REGISTRY}");
    let head = |corpus: &str, expr: &str, extra: &str| {
        format!("set PrettyPrint off;\n{corpus};\n{extra}GUIQuery = {expr};\nsize GUIQuery;")
    };
    match s(p, "op") {
        "health" => format!("{CWB_BIN}/cqp -v"),
        "search" | "export" => {
            let off = n(p, "offset");
            let last = off + n(p, "limit") - 1;
            format!(
                "# {cqp}\n{}\n# then, if there are matches (end clipped to size-1):\n{}tabulate GUIQuery {off} {last} {};",
                head(s(p, "corpus"), s(p, "expression"), ""),
                crate::query::sort_command(s(p, "sort")).ok().flatten().map(|c| format!("{c}\n")).unwrap_or_default(),
                tabulate_spec(p)
            )
        }
        "frequencies" => format!(
            "# {cqp}\n{}\ngroup GUIQuery {} {};",
            head(s(p, "corpus"), s(p, "expression"), ""),
            s(p, "group_anchor"),
            s(p, "group_field")
        ),
        "collocates" => format!(
            "# {cqp}\n{}\ncat GUIQuery 0 {};\n# piped into:\n/home/s/structeng/scripts/collocates.pl --list --case /dev/stdin",
            head(s(p, "corpus"), s(p, "expression"), "set Context 4 words;\n"),
            n(p, "sample_limit") - 1
        ),
        "compare" => {
            let mut out = format!("# {cqp}  (one run per corpus)");
            for c in p["compiled"].as_array().into_iter().flatten() {
                out.push_str(&format!("\n{}", head(c[0].as_str().unwrap_or(""), c[1].as_str().unwrap_or(""), "")));
            }
            out
        }
        "lexicon" => format!("{CWB_BIN}/cwb-lexdecode -r {CWB_REGISTRY} -f -P {} {}", s(p, "field"), s(p, "corpus")),
        "metadata" => format!("{CWB_BIN}/cwb-s-decode -r {CWB_REGISTRY} {} -S {}", s(p, "corpus"), s(p, "attribute")),
        "registry" => format!("ls {CWB_REGISTRY}   # then each registry file is read; new corpora:\n{CWB_BIN}/cwb-describe-corpus -s -r {CWB_REGISTRY} <CORPUS>"),
        "distribution" => format!(
            "# {cqp}\n{}\ntabulate GUIQuery 0 <min(size, {})-1> match {};\n# counted per value, then sizes from:\n{CWB_BIN}/cwb-s-decode -r {CWB_REGISTRY} {} -S {}",
            head(s(p, "corpus"), s(p, "expression"), ""),
            n(p, "cap"), s(p, "attribute"), s(p, "corpus"), s(p, "attribute")
        ),
        "syntax" => format!(
            "{CWB_BIN}/cwb-decode -r {CWB_REGISTRY} -C -s {pos} -e {pos} EFCAM -P tokid\n# then the whole sentence:\n{CWB_BIN}/cwb-decode -r {CWB_REGISTRY} -C -s <start> -e <start+254> EFCAM -P word -P pos -P lemma -P tokid -P head -P rel",
            pos = n(p, "position")
        ),
        "workflow" => {
            let mut out = format!(
                "# one persistent {cqp} process; after each step the worker asks `size Qn;`\n# (empty steps are skipped safely)\n{}",
                s(p, "script").trim_end()
            );
            let last = s(p, "result_name");
            match s(p, "mode") {
                "group" => out.push_str(&format!("\ngroup {last} {} {};", s(p, "group_anchor"), s(p, "group_field"))),
                "sample" => out.push_str(&format!(
                    "\nSampleResult = {last};\nsort SampleResult randomize {};\ntabulate SampleResult 0 {} {};",
                    n(p, "seed"),
                    n(p, "limit") - 1,
                    tabulate_spec(p)
                )),
                _ => {
                    let off = n(p, "offset");
                    out.push_str(&format!("\ntabulate {last} {off} {} {};", off + n(p, "limit") - 1, tabulate_spec(p)))
                }
            }
            out
        }
        other => format!("# unknown op {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn search_commands_match_worker() {
        let p = json!({"op":"search","corpus":"BROWN-LEGACY","expression":"[word=\"jury\" %c]","offset":0,"limit":25,"context":4,"source_attribute":"file_id"});
        let c = cqp_commands(&p);
        assert!(c.contains("BROWN-LEGACY;\nGUIQuery = [word=\"jury\" %c];\nsize GUIQuery;"));
        assert!(c.contains("tabulate GUIQuery 0 24 match, matchend, match[-4]..match[-1] word"));
        assert!(c.contains(", match file_id;"));
        assert_eq!(summarize(&p), "BROWN-LEGACY · [word=\"jury\" %c] · rows 1–25");
    }

    #[test]
    fn log_is_bounded_and_records_results() {
        let log = ConsoleLog::default();
        for _ in 0..(CAPACITY + 5) {
            log.event("connect", "info", "x");
        }
        assert_eq!(log.snapshot().len(), CAPACITY);
        let id = log.begin_request(&json!({"op":"health"}), false);
        log.finish_ok(id, "{\"ok\":true}", "", 0.2, false);
        let e = log.snapshot().into_iter().find(|e| e.id == id).unwrap();
        assert_eq!(e.status, "ok");
        assert!(e.response.unwrap().contains("\"ok\": true"));
    }
}
