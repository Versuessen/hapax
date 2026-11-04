//! The Tauri IPC surface. Every function here is an async `#[tauri::command]`
//! returning `Result<T, AppError>`; `T` and `AppError` serialize to plain JSON.
//!
//! JS calling convention: top-level argument names are camelCase on the JS
//! side (`invoke('run_search', { request: {...} })`); fields *inside* request
//! objects stay snake_case, exactly like the v3 Python request dicts.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::corpora::{self, CorpusInfo, CQP_VERSION_NOTE, CWB_REGISTRY};
use crate::engine::{AppState, Timed};
use crate::error::{AppError, AppResult};
use crate::export::{self, EvidenceRow};
use crate::guide::{self, Explanation, GlossaryRow, Recipe, RecipeInput};
use crate::parse::{self, *};
use crate::query::*;
use crate::ssh::{ConnectParams, HostKeyPrompt, SshSession, TrustDecider};
use crate::storage::{self, Preferences, SavedSearch};
use crate::workflow::{self, CompiledWorkflow, WorkflowRequest};

pub const HOST_KEY_EVENT: &str = "ssh://host-key-prompt";
pub const CONNECTION_EVENT: &str = "ssh://connection";
const HOST_KEY_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

// ===========================================================================
// App / inventory
// ===========================================================================

#[derive(Serialize)]
pub struct AppInfo {
    pub app_name: &'static str,
    pub version: &'static str,
    pub corpora: &'static corpora::Inventory,
    pub group_positions: Vec<(&'static str, &'static str)>,
    pub context_sizes: Vec<u32>,
    pub preferences_path: Option<String>,
    pub known_hosts_path: Option<String>,
    pub events: Value,
}

#[tauri::command]
pub async fn get_app_info() -> AppResult<AppInfo> {
    Ok(AppInfo {
        app_name: "Hapax",
        version: env!("CARGO_PKG_VERSION"),
        corpora: corpora::all(),
        group_positions: GROUP_LABELS.to_vec(),
        context_sizes: CONTEXT_SIZES.to_vec(),
        preferences_path: storage::prefs_path().ok().map(|p| p.display().to_string()),
        known_hosts_path: crate::ssh::known_hosts_path().ok().map(|p| p.display().to_string()),
        events: json!({ "host_key_prompt": HOST_KEY_EVENT, "connection": CONNECTION_EVENT }),
    })
}

/// Read the server's corpus registry and make it the live inventory.
/// Called by the frontend right after every successful connect.
#[tauri::command]
pub async fn discover_corpora(state: State<'_, AppState>) -> AppResult<corpora::Discovery> {
    let known: Vec<String> = corpora::bundled().keys().map(|k| k.to_lowercase()).collect();
    let payload = json!({ "op": "registry", "known": known });
    let (raw, _, _) = state.execute(&payload, false).await?;
    let reply = parse::worker_json(&raw)?;
    let d = corpora::merge_registry(&Value::Object(reply));
    if d.corpora.values().all(|c| !c.available) {
        // An empty or unreadable registry is more likely a server hiccup than
        // every corpus vanishing: keep the current inventory.
        return Err(AppError::Remote("The corpus registry on the server returned no corpora. The corpus list was left unchanged.".into()));
    }
    corpora::replace(d.corpora.clone());
    state.clear_cache();
    Ok(d)
}

#[tauri::command]
pub async fn get_corpus(name: String) -> AppResult<CorpusInfo> {
    corpora::get(&name).cloned()
}

// ===========================================================================
// Preferences & saved searches
// ===========================================================================

#[tauri::command]
pub async fn get_preferences(state: State<'_, AppState>) -> AppResult<Preferences> {
    Ok(state.prefs_snapshot())
}

#[tauri::command]
pub async fn save_preferences(state: State<'_, AppState>, preferences: Preferences) -> AppResult<Preferences> {
    state.update_prefs(|p| *p = preferences)
}

#[tauri::command]
pub async fn save_search(state: State<'_, AppState>, name: String, query: QuerySpec) -> AppResult<Vec<SavedSearch>> {
    build_query(&query)?;
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::Validation("Give the search a name (1–200 characters)".into()));
    }
    let p = state.update_prefs(|p| {
        p.saved_searches.retain(|s| s.name != name);
        p.saved_searches.push(SavedSearch { name, query: serde_json::to_value(&query).unwrap_or_default() });
        p.corpus = query.corpus.clone();
    })?;
    Ok(p.saved_searches)
}

#[tauri::command]
pub async fn delete_saved_search(state: State<'_, AppState>, name: String) -> AppResult<Vec<SavedSearch>> {
    Ok(state.update_prefs(|p| p.saved_searches.retain(|s| s.name != name))?.saved_searches)
}

// ===========================================================================
// SSH lifecycle
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct ConnectArgs {
    pub host: String,
    pub user: String,
    #[serde(default = "port22")]
    pub port: u16,
    /// Empty/absent: use the saved vault password, else default SSH keys.
    #[serde(default)]
    pub password: Option<String>,
    /// Save a newly typed password in the OS credential vault.
    #[serde(default)]
    pub remember: bool,
}
fn port22() -> u16 { 22 }

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub host: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub busy: bool,
}

#[derive(Debug, Serialize)]
pub struct ConnectResult {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub engine: String,
    pub used_saved_password: bool,
    /// Set when the connection worked but the password could not be stored.
    pub warning: Option<String>,
}

fn trust_decider(app: AppHandle, pending: crate::engine::PendingHostKeys) -> TrustDecider {
    std::sync::Arc::new(move |prompt: HostKeyPrompt| {
        let app = app.clone();
        let pending = pending.clone();
        Box::pin(async move {
            let (tx, rx) = oneshot::channel();
            let id = prompt.request_id.clone();
            app.state::<AppState>().console.event("host_key", "info", format!("Unknown host key for {}:{} — {} {} — asking you", prompt.host, prompt.port, prompt.key_type, prompt.fingerprint));
            pending.lock().unwrap_or_else(|p| p.into_inner()).insert(id.clone(), tx);
            if app.emit(HOST_KEY_EVENT, &prompt).is_err() {
                pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
                return false;
            }
            let answer = tokio::time::timeout(HOST_KEY_PROMPT_TIMEOUT, rx).await;
            pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
            let trusted = matches!(answer, Ok(Ok(true)));
            app.state::<AppState>().console.event("host_key", if trusted { "ok" } else { "error" }, if trusted { "Host key trusted and added to known_hosts" } else { "Host key not trusted — connection refused" });
            trusted
        })
    })
}

async fn status_of(state: &AppState) -> ConnectionStatus {
    match state.session().await {
        Some(s) if s.is_connected() => ConnectionStatus {
            connected: true, host: Some(s.host.clone()), user: Some(s.user.clone()), port: Some(s.port), busy: state.is_busy(),
        },
        _ => ConnectionStatus { connected: false, host: None, user: None, port: None, busy: state.is_busy() },
    }
}

#[tauri::command]
pub async fn ssh_connect(app: AppHandle, state: State<'_, AppState>, args: ConnectArgs) -> AppResult<ConnectResult> {
    let host = args.host.trim().to_string();
    let user = args.user.trim().to_string();
    if host.is_empty() || user.is_empty() {
        return Err(AppError::Validation("Enter host and username".into()));
    }
    crate::ssh::validate_target(&host, &user, args.port)?;
    let typed = args.password.clone().filter(|p| !p.is_empty());
    let saved = if typed.is_none() { storage::get_password(&host, &user, args.port) } else { None };
    let used_saved_password = saved.is_some();
    let password = typed.clone().or(saved);

    // Replace any existing session (v3 `connect` closes first).
    if let Some(old) = state.set_session(None).await {
        old.close().await;
    }
    state.clear_cache();

    let auth = if typed.is_some() { "typed password" } else if used_saved_password { "saved password from the OS vault" } else { "SSH keys in ~/.ssh" };
    state.console.event("connect", "info", format!("Connecting to {user}@{host}:{} using {auth} (password never logged)", args.port));
    let session = {
        let (_guard, token) = state.begin()?;
        let params = ConnectParams { host: host.clone(), user: user.clone(), port: args.port, password };
        let decider = trust_decider(app.clone(), state.pending_host_keys.clone());
        let connected = tokio::select! {
            _ = token.cancelled() => Err(AppError::Cancelled),
            s = SshSession::connect(params, decider) => s,
        };
        match connected {
            Ok(s) => {
                state.console.event("connect", "ok", format!("SSH session established with {user}@{host}:{}", args.port));
                std::sync::Arc::new(s)
            }
            Err(e) => {
                state.console.event("connect", if matches!(e, AppError::Cancelled) { "cancelled" } else { "error" }, format!("Connection failed: {e}"));
                return Err(e);
            }
        }
    };
    state.set_session(Some(session.clone())).await;

    // Health check; on failure drop the half-working session (v3 behaviour).
    let health = match state.execute(&health_payload(), false).await.and_then(|(raw, _, _)| parse::decode_health(&raw)) {
        Ok(h) => h,
        Err(e) => {
            state.set_session(None).await;
            session.close().await;
            return Err(e);
        }
    };

    let mut warning = None;
    if args.remember {
        if let Some(pw) = &typed {
            if let Err(e) = storage::set_password(&host, &user, args.port, pw) {
                warning = Some(e.to_string());
            }
        }
    }
    let _ = state.update_prefs(|p| {
        p.host = host.clone();
        p.user = user.clone();
        p.port = args.port;
    });
    let _ = app.emit(CONNECTION_EVENT, status_of(&state).await);
    Ok(ConnectResult { host, user, port: args.port, engine: health.version, used_saved_password, warning })
}

#[tauri::command]
pub async fn ssh_disconnect(app: AppHandle, state: State<'_, AppState>) -> AppResult<ConnectionStatus> {
    if state.is_busy() {
        return Err(AppError::Validation("Please complete the current operation before disconnecting".into()));
    }
    if let Some(s) = state.set_session(None).await {
        s.close().await;
        state.console.event("disconnect", "info", format!("Disconnected from {}@{}", s.user, s.host));
    }
    state.clear_cache();
    let status = status_of(&state).await;
    let _ = app.emit(CONNECTION_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn ssh_status(state: State<'_, AppState>) -> AppResult<ConnectionStatus> {
    Ok(status_of(&state).await)
}

/// Answer an `ssh://host-key-prompt` event.
#[tauri::command]
pub async fn answer_host_key(state: State<'_, AppState>, request_id: String, trust: bool) -> AppResult<()> {
    let sender = state.pending_host_keys.lock().unwrap_or_else(|p| p.into_inner()).remove(&request_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(trust);
            Ok(())
        }
        None => Err(AppError::Validation("That host-key question has expired; connect again".into())),
    }
}

/// "Stop request": closes the active SSH channel (best effort).
#[tauri::command]
pub async fn cancel_request(state: State<'_, AppState>) -> AppResult<bool> {
    let was_busy = state.is_busy();
    state.cancel_current();
    if was_busy {
        state.console.event("cancel", "info", "Stop requested: closing the active SSH channel (server process may finish in the background)");
    }
    Ok(was_busy)
}

#[tauri::command]
pub async fn has_saved_password(host: String, user: String, port: Option<u16>) -> AppResult<bool> {
    Ok(storage::get_password(host.trim(), user.trim(), port.unwrap_or(22)).is_some())
}

#[tauri::command]
pub async fn forget_password(host: String, user: String, port: Option<u16>) -> AppResult<bool> {
    storage::delete_password(host.trim(), user.trim(), port.unwrap_or(22))
}

// ===========================================================================
// Query helpers (local, no network)
// ===========================================================================

#[derive(Serialize)]
pub struct QueryPreview {
    pub corpus: String,
    pub expression: String,
    pub field: String,
    pub cqp_command: String,
}

#[tauri::command]
pub async fn preview_query(query: QuerySpec) -> AppResult<QueryPreview> {
    let c = build_query(&query)?;
    Ok(QueryPreview { cqp_command: c.cqp_command(), corpus: c.corpus, expression: c.expression, field: c.field })
}

#[tauri::command]
pub async fn interpret_search(query: QuerySpec, total: u64) -> AppResult<String> {
    let tokens = corpora::get(&query.corpus)?.tokens;
    Ok(workflow::interpretation(&query, total, tokens))
}

#[tauri::command]
pub async fn compile_workflow_plan(plan: Value) -> AppResult<CompiledWorkflow> {
    workflow::compile_workflow(&plan)
}

#[tauri::command]
pub async fn explain_workflow_result(plan: Value, total: u64) -> AppResult<String> {
    let corpus = plan.get("corpus").and_then(Value::as_str).unwrap_or_default();
    let tokens = corpora::get(corpus)?.tokens;
    workflow::explain_workflow(&plan, total, tokens)
}

// ===========================================================================
// Remote operations
// ===========================================================================

fn annotate(corpus: &str, field: &str, rows: &mut [GroupRow]) {
    for r in rows {
        r.meaning = Some(guide::explain(corpus, field, &r.value).short);
    }
}

#[tauri::command]
pub async fn run_health(state: State<'_, AppState>) -> AppResult<Timed<HealthResult>> {
    let (raw, elapsed_seconds, cached) = state.execute(&health_payload(), false).await?;
    Ok(Timed { data: parse::decode_health(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_search(state: State<'_, AppState>, request: SearchRequest) -> AppResult<Timed<SearchResult>> {
    let payload = search_payload(&request, false)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, true).await?;
    Ok(Timed { data: parse::decode_search(&raw, &payload)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_frequencies(state: State<'_, AppState>, request: FrequencyRequest) -> AppResult<Timed<GroupResult>> {
    let payload = frequency_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    let mut data = parse::decode_frequencies(&raw)?;
    annotate(&request.query.corpus, &request.group_field, &mut data.groups);
    Ok(Timed { data, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_collocates(state: State<'_, AppState>, request: CollocateRequest) -> AppResult<Timed<CollocateResult>> {
    let payload = collocate_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    Ok(Timed { data: parse::decode_collocates(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_lexicon(state: State<'_, AppState>, request: LexiconRequest) -> AppResult<Timed<LexiconResult>> {
    let payload = lexicon_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    let mut data = parse::decode_lexicon(&raw)?;
    annotate(&request.corpus, &request.field, &mut data.groups);
    Ok(Timed { data, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_metadata(state: State<'_, AppState>, request: MetadataRequest) -> AppResult<Timed<MetadataResult>> {
    let payload = metadata_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    Ok(Timed { data: parse::decode_metadata(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_distribution(state: State<'_, AppState>, request: DistributionRequest) -> AppResult<Timed<parse::DistributionResult>> {
    let payload = distribution_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, true).await?;
    Ok(Timed { data: parse::decode_distribution(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_syntax(state: State<'_, AppState>, request: SyntaxRequest) -> AppResult<Timed<SyntaxResult>> {
    let payload = syntax_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    Ok(Timed { data: parse::decode_syntax(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_compare(state: State<'_, AppState>, request: CompareRequest) -> AppResult<Timed<CompareResult>> {
    let payload = compare_payload(&request)?;
    let (raw, elapsed_seconds, cached) = state.execute(&payload, false).await?;
    Ok(Timed { data: parse::decode_compare(&raw)?, elapsed_seconds, cached })
}

#[tauri::command]
pub async fn run_workflow(state: State<'_, AppState>, request: WorkflowRequest) -> AppResult<Timed<WorkflowResult>> {
    let payload = workflow::workflow_payload(&request)?;
    let cacheable = matches!(request.mode.as_str(), "results" | "sample");
    let (raw, elapsed_seconds, cached) = state.execute(&payload, cacheable).await?;
    let mut data = parse::decode_workflow(&raw, &payload)?;
    if let (Some(groups), Some(field)) = (data.groups.as_mut(), payload["group_field"].as_str()) {
        let corpus = payload["plan"]["corpus"].as_str().unwrap_or_default();
        annotate(corpus, field, groups);
    }
    Ok(Timed { data, elapsed_seconds, cached })
}

// ===========================================================================
// Learning / codebook (local)
// ===========================================================================

#[tauri::command]
pub async fn explain_annotation(corpus: String, field: String, value: String) -> AppResult<Explanation> {
    corpora::get(&corpus)?;
    Ok(guide::explain(&corpus, &field, &value))
}

#[tauri::command]
pub async fn explain_field(corpus: String, field: String) -> AppResult<Explanation> {
    Ok(guide::field_explanation(&corpus, &field))
}

#[tauri::command]
pub async fn get_glossary(corpus: String) -> AppResult<Vec<GlossaryRow>> {
    corpora::get(&corpus)?;
    Ok(guide::glossary_rows(&corpus))
}

#[derive(Serialize)]
pub struct GuidedQuestions {
    pub modes: &'static [String],
    pub parts: &'static [String],
}

#[tauri::command]
pub async fn get_guided_questions() -> AppResult<GuidedQuestions> {
    Ok(GuidedQuestions { modes: guide::guided_modes(), parts: guide::parts_of_speech() })
}

#[tauri::command]
pub async fn build_guided_recipe(input: RecipeInput) -> AppResult<Recipe> {
    guide::build_recipe(&input)
}

// ===========================================================================
// Local exports (paths come from the native Save dialog in the frontend)
// ===========================================================================

#[derive(Serialize)]
pub struct ExportReport {
    pub path: String,
    pub rows: usize,
    pub total: Option<u64>,
    pub provenance_path: Option<String>,
}

const KWIC_COLUMNS: [&str; 6] = ["start", "end", "left", "text", "right", "source"];

fn cols(c: &[&str]) -> Vec<String> {
    c.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
pub async fn export_table(path: PathBuf, rows: Vec<Value>, columns: Option<Vec<String>>) -> AppResult<ExportReport> {
    let n = export::write_table(&path, &rows, columns.as_deref())?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: None, provenance_path: None })
}

fn concordance_provenance(request: &SearchRequest, total: u64, exported: usize, elapsed: Option<f64>) -> AppResult<Value> {
    let compiled = build_query(&request.query)?;
    Ok(json!({
        "generated_utc": export::utc_now(),
        "corpus": compiled.corpus,
        "cqp_query": compiled.expression,
        "query_parameters": request,
        "total_matches": total,
        "exported_rows": exported,
        "partial_export": (exported as u64) < total,
        "cwb_registry": CWB_REGISTRY,
        "cqp_version": CQP_VERSION_NOTE,
        "last_completed_operation_wall_seconds": elapsed,
        "timing_note": "Includes SSH round trip and frontend polling, not just the CQP engine execution",
    }))
}

/// Export the concordance page currently on screen (+ provenance sidecar).
#[tauri::command]
pub async fn export_concordance_page(
    state: State<'_, AppState>,
    path: PathBuf,
    request: SearchRequest,
    rows: Vec<ConcordanceRow>,
    total: u64,
) -> AppResult<ExportReport> {
    let values: Vec<Value> = rows.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect();
    let n = export::write_table(&path, &values, Some(&cols(&KWIC_COLUMNS)))?;
    let prov = export::write_provenance(&path, &concordance_provenance(&request, total, n, state.last_elapsed())?)?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: Some(total), provenance_path: Some(prov.display().to_string()) })
}

/// Re-run the search on the server and export the first 5,000 matches.
#[tauri::command]
pub async fn export_search_all(state: State<'_, AppState>, path: PathBuf, request: SearchRequest) -> AppResult<ExportReport> {
    export::format_for(&path)?;
    let mut req = request.clone();
    req.offset = 0;
    req.limit = corpora::SEARCH_LIMIT;
    let payload = search_payload(&req, true)?;
    let (raw, elapsed, _) = state.execute(&payload, false).await?;
    let data = parse::decode_search(&raw, &payload)?;
    let values: Vec<Value> = data.results.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect();
    let n = export::write_table(&path, &values, Some(&cols(&KWIC_COLUMNS)))?;
    let prov = export::write_provenance(&path, &concordance_provenance(&req, data.total, n, Some(elapsed))?)?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: Some(data.total), provenance_path: Some(prov.display().to_string()) })
}

/// Re-run a workflow and export its first 5,000 matching spans (corpus order).
#[tauri::command]
pub async fn export_workflow_all(state: State<'_, AppState>, path: PathBuf, plan: Value) -> AppResult<ExportReport> {
    export::format_for(&path)?;
    let req = WorkflowRequest {
        plan: plan.clone(), mode: "export".into(), offset: 0, limit: 5000, context: 4,
        seed: None, group_field: None, group_position: None,
    };
    let payload = workflow::workflow_payload(&req)?;
    let (raw, _, _) = state.execute(&payload, false).await?;
    let data = parse::decode_workflow(&raw, &payload)?;
    let rows = data.results.unwrap_or_default();
    let values: Vec<Value> = rows.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect();
    let n = export::write_table(&path, &values, Some(&cols(&KWIC_COLUMNS)))?;
    let prov = export::write_provenance(&path, &json!({
        "generated_utc": export::utc_now(),
        "workflow": payload["plan"],
        "total_matching_spans": data.total,
        "exported_rows": n,
        "partial": (n as u64) < data.total,
        "note": "Results are first N matching spans in corpus order, not a random sample.",
    }))?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: Some(data.total), provenance_path: Some(prov.display().to_string()) })
}

/// Export the workflow result currently on screen (rows or groups).
#[tauri::command]
pub async fn export_workflow_view(state: State<'_, AppState>, path: PathBuf, plan: Value, result: WorkflowResult) -> AppResult<ExportReport> {
    let is_groups = result.groups.is_some();
    let values: Vec<Value> = if let Some(g) = &result.groups {
        g.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect()
    } else {
        result.results.clone().unwrap_or_default().iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect()
    };
    let columns = if is_groups { cols(&["value", "meaning", "count"]) } else { cols(&KWIC_COLUMNS) };
    let n = export::write_table(&path, &values, Some(&columns))?;
    let prov = export::write_provenance(&path, &json!({
        "generated_utc": export::utc_now(),
        "workflow": plan,
        "total_matching_spans": result.total,
        "exported_rows": n,
        "partial": (!is_groups && (n as u64) < result.total) || result.truncated,
        "sampling_method": result.sampling_method,
        "random_seed": result.seed,
        "elapsed_seconds_last_request": state.last_elapsed(),
        "note": "Counts reflect matching spans; normalization uses all indexed corpus tokens.",
    }))?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: Some(result.total), provenance_path: Some(prov.display().to_string()) })
}

#[tauri::command]
pub async fn export_comparison(path: PathBuf, request: CompareRequest, result: CompareResult) -> AppResult<ExportReport> {
    // Log-likelihood (G²) of each corpus against the first (reference) corpus.
    let reference = result.results.first().cloned();
    let values: Vec<Value> = result.results.iter().enumerate().map(|(i, r)| {
        let mut v = serde_json::to_value(r).unwrap_or_default();
        if let (Some(rf), true) = (&reference, i > 0) {
            v["ll_vs_reference"] = json!((log_likelihood(r.total as f64, r.tokens as f64, rf.total as f64, rf.tokens as f64) * 100.0).round() / 100.0);
        } else {
            v["ll_vs_reference"] = json!("");
        }
        v
    }).collect();
    let n = export::write_table(&path, &values, Some(&cols(&["corpus", "total", "tokens", "per_million_tokens", "ll_vs_reference"])))?;
    let prov = export::write_provenance(&path, &json!({
        "generated_utc": export::utc_now(),
        "corpora": request.corpora,
        "search_type": request.field,
        "query": request.value,
        "full_query": request.query,
        "filters_per_corpus": request.filters,
        "reference_corpus": request.corpora.first(),
        "ignore_case": request.ignore_case,
        "data": result.results,
        "note": "Token-normalized rates. ll_vs_reference is log-likelihood (G2) against the first corpus (3.84/6.63/10.83 = p<.05/.01/.001); it treats tokens as independent and is not a controlled corpus comparison.",
    }))?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: None, provenance_path: Some(prov.display().to_string()) })
}

#[tauri::command]
pub async fn export_syntax(path: PathBuf, data: SyntaxResult) -> AppResult<String> {
    export::write_syntax(&path, &data)?;
    Ok(path.display().to_string())
}

// ===========================================================================
// Workflow plan files & evidence notebook
// ===========================================================================

#[tauri::command]
pub async fn workflow_save(path: PathBuf, plan: Value) -> AppResult<String> {
    export::save_workflow(&path, &plan)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn workflow_load(path: PathBuf) -> AppResult<Value> {
    export::load_workflow(&path)
}

#[derive(Serialize)]
pub struct EvidenceMerge {
    pub rows: Vec<EvidenceRow>,
    pub added: usize,
}

#[tauri::command]
pub async fn evidence_add(notebook: Vec<EvidenceRow>, corpus: String, rows: Vec<Value>, query: Value) -> AppResult<EvidenceMerge> {
    let (rows, added) = export::merge_evidence(notebook, &corpus, &rows, &query)?;
    Ok(EvidenceMerge { rows, added })
}

#[tauri::command]
pub async fn evidence_save(path: PathBuf, rows: Vec<EvidenceRow>) -> AppResult<String> {
    export::save_evidence(&path, &rows)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn evidence_open(path: PathBuf) -> AppResult<Vec<EvidenceRow>> {
    export::open_evidence(&path)
}

#[tauri::command]
pub async fn evidence_export(path: PathBuf, rows: Vec<EvidenceRow>) -> AppResult<ExportReport> {
    let values: Vec<Value> = rows.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect();
    let n = export::write_table(&path, &values, Some(&cols(&export::EVIDENCE_COLUMNS)))?;
    Ok(ExportReport { path: path.display().to_string(), rows: n, total: None, provenance_path: None })
}

// ===========================================================================
// Request console
// ===========================================================================

#[tauri::command]
pub async fn get_console_log(state: State<'_, AppState>) -> AppResult<Vec<crate::console::ConsoleEntry>> {
    Ok(state.console.snapshot())
}

#[tauri::command]
pub async fn clear_console_log(state: State<'_, AppState>) -> AppResult<()> {
    state.console.clear();
    Ok(())
}

/// Save the console as JSON (.json) or a readable text log (.log / .txt).
#[tauri::command]
pub async fn export_console_log(state: State<'_, AppState>, path: PathBuf) -> AppResult<String> {
    let entries = state.console.snapshot();
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let body = if matches!(ext.as_deref(), Some("sh") | Some("cqp")) {
        let style = if ext.as_deref() == Some("sh") { crate::terminal::Style::Shell } else { crate::terminal::Style::Cqp };
        let mut out = String::from(if style == crate::terminal::Style::Shell { "#!/bin/bash\n# Commands from a Hapax session, in order. Read-only.\n\n" } else { "" });
        for e in entries.iter().filter(|e| e.kind == "request" && e.request.is_some()) {
            out.push_str(&crate::terminal::render(e.request.as_ref().unwrap(), style, &e.summary));
            out.push('\n');
        }
        out
    } else if ext.as_deref() == Some("json") {
        serde_json::to_string_pretty(&entries)?
    } else {
        let mut out = String::new();
        for e in &entries {
            out.push_str(&format!("[{}] #{} {} {} ({}){}\n  {}\n", e.at, e.id, e.kind.to_uppercase(), e.op, e.status,
                e.elapsed_seconds.map(|s| format!(" {s:.2}s")).unwrap_or_default(), e.summary));
            if let Some(x) = &e.exec { out.push_str(&format!("  $ {x}\n")); }
            if let Some(c) = &e.commands { out.push_str("  -- commands --\n"); for l in c.lines() { out.push_str(&format!("  {l}\n")); } }
            if let Some(r) = &e.request { out.push_str(&format!("  -- request (stdin) --\n  {}\n", serde_json::to_string(r)?)); }
            if let Some(r) = &e.response { out.push_str("  -- response (stdout) --\n"); for l in r.lines() { out.push_str(&format!("  {l}\n")); } }
            if let Some(r) = &e.stderr { out.push_str("  -- stderr --\n"); for l in r.lines() { out.push_str(&format!("  {l}\n")); } }
            if let Some(r) = &e.error { out.push_str(&format!("  !! {r}\n")); }
            out.push('\n');
        }
        out
    };
    std::fs::write(&path, body)?;
    Ok(path.display().to_string())
}

// ===========================================================================
// Copy-paste commands for your own SSH terminal
// ===========================================================================

/// Translate a GUI request (same shape as the matching `run_*` command) into
/// commands for the `cqp>` prompt (`style = "cqp"`) or a bash snippet (`"shell"`).
/// Uses the same validated payload builders as a real run, so the query is identical.
#[tauri::command]
pub async fn terminal_commands(op: String, request: Value, style: String) -> AppResult<String> {
    fn de<T: serde::de::DeserializeOwned>(v: Value) -> AppResult<T> {
        serde_json::from_value(v).map_err(|e| AppError::Validation(format!("Incomplete request: {e}")))
    }
    let payload = match op.as_str() {
        "search" => search_payload(&de(request)?, false)?,
        "frequencies" => frequency_payload(&de(request)?)?,
        "collocates" => collocate_payload(&de(request)?)?,
        "compare" => compare_payload(&de(request)?)?,
        "lexicon" => lexicon_payload(&de(request)?)?,
        "metadata" => metadata_payload(&de(request)?)?,
        "distribution" => distribution_payload(&de(request)?)?,
        "syntax" => syntax_payload(&de(request)?)?,
        "workflow" => workflow::workflow_payload(&de(request)?)?,
        other => return Err(AppError::Validation(format!("No terminal translation for '{other}'"))),
    };
    Ok(crate::terminal::render(&payload, crate::terminal::Style::parse(&style), &crate::console::summarize(&payload)))
}

/// Same, for a request already logged in the console (its stored payload).
#[tauri::command]
pub async fn terminal_from_payload(payload: Value, style: String) -> AppResult<String> {
    Ok(crate::terminal::render(&payload, crate::terminal::Style::parse(&style), &crate::console::summarize(&payload)))
}

/// Save generated terminal commands to a local file chosen in the Save dialog.
#[tauri::command]
pub async fn save_text(path: PathBuf, text: String) -> AppResult<String> {
    if text.len() > 2_000_000 {
        return Err(AppError::Validation("Text too large to save".into()));
    }
    std::fs::write(&path, text)?;
    Ok(path.display().to_string())
}

/// Log-likelihood G² for observed counts a (in c tokens) vs b (in d tokens).
pub fn log_likelihood(a: f64, c: f64, b: f64, d: f64) -> f64 {
    if c <= 0.0 || d <= 0.0 { return 0.0; }
    let e1 = c * (a + b) / (c + d);
    let e2 = d * (a + b) / (c + d);
    let t = |o: f64, e: f64| if o > 0.0 && e > 0.0 { o * (o / e).ln() } else { 0.0 };
    2.0 * (t(a, e1) + t(b, e2))
}

#[cfg(test)]
mod ll_tests {
    #[test]
    fn log_likelihood_basics() {
        assert!(super::log_likelihood(10.0, 1e6, 10.0, 1e6).abs() < 1e-9);
        let ll = super::log_likelihood(30.0, 1e6, 10.0, 1e6);
        assert!((ll - 10.46).abs() < 0.01, "{ll}");
    }
}
