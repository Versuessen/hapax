//! Parsing of the remote worker's JSON + CQP text payloads (port of the
//! `parse_*`, `decode_remote_response` and `validate_dependency` functions).

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};

fn remote<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::Remote(msg.into()))
}

/// Python `repr()` for error snippets (single-quoted, escapes control chars).
fn snippet(s: &str, max: usize) -> String {
    let cut: String = s.chars().take(max).collect();
    format!("{cut:?}")
}

/// One KWIC concordance line.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConcordanceRow {
    pub start: u64,
    pub end: u64,
    pub left: String,
    pub text: String,
    pub right: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// One frequency/lexicon row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupRow {
    pub value: String,
    pub count: u64,
    /// Plain-language gloss from the codebook (filled in by the command layer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meaning: Option<String>,
}

pub fn parse_sections(output: &str) -> AppResult<Vec<Vec<String>>> {
    let mut sections = Vec::new();
    let mut current = Vec::new();
    for line in output.lines() {
        if line.trim() == "-::-EOL-::-" {
            sections.push(std::mem::take(&mut current));
        } else if !line.starts_with("CQP version ") {
            current.push(line.to_string());
        }
    }
    if sections.is_empty() {
        return remote("CQP response lacked its end marker");
    }
    Ok(sections)
}

fn re_int_line() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*\d+\s*$").unwrap())
}

pub fn parse_size(section: &[String]) -> AppResult<u64> {
    let nums: Vec<u64> = section
        .iter()
        .filter(|v| re_int_line().is_match(v))
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    if nums.len() != 1 {
        let head: Vec<&String> = section.iter().take(3).collect();
        return remote(format!("Unexpected CQP size output: {head:?}"));
    }
    Ok(nums[0])
}

fn is_digits(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.chars().all(|c| c.is_ascii_digit())
}

pub fn parse_page(section: &[Value], has_meta: bool) -> AppResult<Vec<ConcordanceRow>> {
    let expected = if has_meta { 6 } else { 5 };
    let mut out = Vec::new();
    for line in section {
        let line = line.as_str().unwrap_or_default();
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() != expected || !is_digits(parts[0]) || !is_digits(parts[1]) {
            return remote(format!("Unexpected structured concordance: {}", snippet(line, 180)));
        }
        out.push(ConcordanceRow {
            start: parts[0].trim().parse().unwrap_or(0),
            end: parts[1].trim().parse().unwrap_or(0),
            left: parts[2].to_string(),
            text: parts[3].to_string(),
            right: parts[4].to_string(),
            source: has_meta.then(|| parts[5].to_string()),
        });
    }
    Ok(out)
}

pub fn parse_group(section: &[Value], limit: usize) -> AppResult<Vec<GroupRow>> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"^(.*?)\s+(\d+)\s*$").unwrap());
    let mut rows = Vec::new();
    for line in section {
        let line = line.as_str().unwrap_or_default();
        if line.trim().is_empty() {
            continue;
        }
        let Some(m) = re.captures(line) else {
            return remote(format!("Unexpected grouping row: {}", snippet(line, 150)));
        };
        rows.push(GroupRow {
            value: m[1].trim().to_string(),
            count: m[2].parse().unwrap_or(0),
            meaning: None,
        });
    }
    rows.sort_by(|a, b| b.count.cmp(&a.count)); // stable, like Python's sorted()
    rows.truncate(limit);
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Typed results returned to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub total: u64,
    pub results: Vec<ConcordanceRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupResult {
    pub total: u64,
    pub groups: Vec<GroupRow>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollocateResult {
    pub total: u64,
    pub sampled: u64,
    /// Rows of collocates.pl CSV output, keyed by its header.
    pub groups: Vec<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LexiconResult {
    pub groups: Vec<GroupRow>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataRow {
    pub value: String,
    pub regions: u64,
    pub tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataResult {
    pub groups: Vec<MetadataRow>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionRow {
    pub value: String,
    pub hits: u64,
    pub regions: u64,
    pub tokens: u64,
    pub per_million: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionResult {
    pub total: u64,
    /// Matches actually assigned to a value (capped on very large results).
    pub counted: u64,
    pub rows: Vec<DistributionRow>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareRow {
    pub corpus: String,
    pub total: u64,
    pub tokens: u64,
    pub per_million_tokens: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResult {
    pub results: Vec<CompareRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntaxToken {
    pub position: u64,
    pub word: String,
    pub pos: String,
    pub lemma: String,
    pub id: String,
    pub head: String,
    pub rel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyDiagnostics {
    pub roots: Vec<String>,
    pub undefined: usize,
    pub invalid_heads: Vec<String>,
    pub cycle_nodes: Vec<String>,
    pub sequential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntaxResult {
    pub start: u64,
    pub tokens: Vec<SyntaxToken>,
    pub diagnostics: DependencyDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResult {
    pub message: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepCount {
    pub step: u64,
    pub kind: String,
    pub matches: u64,
}

/// Workflow output: either `results` (results/sample/export) or `groups` (group).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResult {
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<ConcordanceRow>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<GroupRow>>,
    pub truncated: bool,
    pub step_counts: Vec<StepCount>,
    pub sampling_method: String,
    pub seed: Option<i64>,
}

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

/// Translate known raw CQP/CWB diagnostics into an explanation; keep the raw text for experts.
pub fn friendly_remote_error(msg: &str) -> String {
    if msg.contains("unrecognised CorpusCharset") || msg.contains("invalid in the encoding specified for this corpus") {
        return format!(
            "This corpus's registry declares a character encoding CWB does not recognise, so CQP \
             rejects every query on it. This is a server configuration issue, not your query. \
             (CQP said: {})",
            msg.lines().next().unwrap_or(msg).trim()
        );
    }
    msg.to_string()
}

/// Parse the worker's stdout as JSON and surface `{"ok": false, "error": ...}`.
pub fn worker_json(raw: &str) -> AppResult<Map<String, Value>> {
    let value: Value = serde_json::from_str(raw.trim()).map_err(|_| {
        let tail: String = raw.chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
        AppError::Remote(format!("Remote worker did not return JSON: {tail}"))
    })?;
    let Value::Object(map) = value else {
        return remote("Remote worker did not return a JSON object");
    };
    if map.get("ok").and_then(Value::as_bool) != Some(true) {
        let msg = map.get("error").and_then(Value::as_str).unwrap_or("Remote operation failed");
        return remote(friendly_remote_error(msg));
    }
    Ok(map)
}

fn u64_of(v: &Map<String, Value>, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}
fn array_of<'a>(v: &'a Map<String, Value>, k: &str) -> &'a [Value] {
    v.get(k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

pub fn decode_search(raw: &str, payload: &Value) -> AppResult<SearchResult> {
    let v = worker_json(raw)?;
    let has_meta = !payload["source_attribute"].is_null();
    let rows = parse_page(array_of(&v, "rows"), has_meta)?;
    let total = u64_of(&v, "total");
    let offset = payload["offset"].as_u64().unwrap_or(0);
    let limit = payload["limit"].as_u64().unwrap_or(25);
    if offset < total {
        let expected = limit.min(total - offset);
        if rows.len() as u64 != expected {
            return remote(format!("Expected {expected} concordances; received {}", rows.len()));
        }
    }
    Ok(SearchResult { total, results: rows })
}

pub fn decode_frequencies(raw: &str) -> AppResult<GroupResult> {
    let v = worker_json(raw)?;
    Ok(GroupResult {
        total: u64_of(&v, "total"),
        groups: parse_group(array_of(&v, "lines"), 300)?,
        truncated: v.get("truncated").and_then(Value::as_bool).unwrap_or(false),
    })
}

pub fn decode_collocates(raw: &str) -> AppResult<CollocateResult> {
    let v = worker_json(raw)?;
    let text = v.get("csv").and_then(Value::as_str).unwrap_or("");
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(text.as_bytes());
    let headers = reader.headers()?.clone();
    let mut groups = Vec::new();
    for rec in reader.records() {
        let rec = rec?;
        let row = headers.iter().zip(rec.iter()).map(|(h, c)| (h.to_string(), c.to_string())).collect();
        groups.push(row);
    }
    Ok(CollocateResult { total: u64_of(&v, "total"), sampled: u64_of(&v, "sampled"), groups })
}

pub fn decode_lexicon(raw: &str) -> AppResult<LexiconResult> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"^\s*(\d+)\s+(.*?)\s*$").unwrap());
    let v = worker_json(raw)?;
    let mut groups: Vec<GroupRow> = array_of(&v, "lines")
        .iter()
        .filter_map(|l| l.as_str())
        .filter_map(|l| re.captures(l))
        .map(|m| GroupRow { value: m[2].to_string(), count: m[1].parse().unwrap_or(0), meaning: None })
        .collect();
    groups.sort_by(|a, b| b.count.cmp(&a.count));
    Ok(LexiconResult { groups, truncated: v.get("truncated").and_then(Value::as_bool).unwrap_or(false) })
}

pub fn decode_metadata(raw: &str) -> AppResult<MetadataResult> {
    let v = worker_json(raw)?;
    let mut groups = Vec::new();
    for item in array_of(&v, "values") {
        // [name, [regions, tokens]]
        let name = item.get(0).and_then(Value::as_str).unwrap_or_default().to_string();
        let regions = item.get(1).and_then(|t| t.get(0)).and_then(Value::as_u64).unwrap_or(0);
        let tokens = item.get(1).and_then(|t| t.get(1)).and_then(Value::as_u64).unwrap_or(0);
        groups.push(MetadataRow { value: name, regions, tokens });
    }
    Ok(MetadataResult { groups, truncated: v.get("truncated").and_then(Value::as_bool).unwrap_or(false) })
}

pub fn decode_distribution(raw: &str) -> AppResult<DistributionResult> {
    let v = worker_json(raw)?;
    let mut rows = Vec::new();
    for item in array_of(&v, "values") {
        // [value, hits, regions, tokens]
        let g = |i: usize| item.get(i).and_then(Value::as_u64).unwrap_or(0);
        let tokens = g(3);
        rows.push(DistributionRow {
            value: item.get(0).and_then(Value::as_str).unwrap_or_default().to_string(),
            hits: g(1),
            regions: g(2),
            tokens,
            per_million: if tokens > 0 { (g(1) as f64 * 1_000_000.0 / tokens as f64 * 100.0).round() / 100.0 } else { 0.0 },
        });
    }
    Ok(DistributionResult {
        total: u64_of(&v, "total"),
        counted: u64_of(&v, "counted"),
        rows,
        truncated: v.get("truncated").and_then(Value::as_bool).unwrap_or(false),
    })
}

pub fn decode_compare(raw: &str) -> AppResult<CompareResult> {
    let v = worker_json(raw)?;
    let results = serde_json::from_value(v.get("results").cloned().unwrap_or(Value::Array(vec![])))
        .map_err(|e| AppError::Remote(format!("Unexpected comparison output: {e}")))?;
    Ok(CompareResult { results })
}

pub fn decode_syntax(raw: &str) -> AppResult<SyntaxResult> {
    let v = worker_json(raw)?;
    let tokens: Vec<SyntaxToken> = serde_json::from_value(v.get("tokens").cloned().unwrap_or_default())
        .map_err(|e| AppError::Remote(format!("Unexpected EFCAM token rows: {e}")))?;
    let diagnostics = validate_dependency(&tokens);
    Ok(SyntaxResult { start: u64_of(&v, "start"), tokens, diagnostics })
}

pub fn decode_health(raw: &str) -> AppResult<HealthResult> {
    let v = worker_json(raw)?;
    Ok(HealthResult {
        message: v.get("message").and_then(Value::as_str).unwrap_or("CWB runtime reachable").into(),
        version: v.get("version").and_then(Value::as_str).unwrap_or("CQP").into(),
    })
}

pub fn decode_workflow(raw: &str, payload: &Value) -> AppResult<WorkflowResult> {
    let v = worker_json(raw)?;
    let total = u64_of(&v, "total");
    let step_counts: Vec<StepCount> =
        serde_json::from_value(v.get("step_counts").cloned().unwrap_or(Value::Array(vec![]))).unwrap_or_default();
    let sampling_method =
        v.get("sampling_method").and_then(Value::as_str).unwrap_or("corpus order").to_string();
    let seed = v.get("seed").and_then(Value::as_i64);

    if payload["mode"] == "group" {
        let lines = array_of(&v, "lines");
        let truncated = v.get("truncated").and_then(Value::as_bool).unwrap_or(false) || lines.len() > 300;
        return Ok(WorkflowResult {
            total,
            results: None,
            groups: Some(parse_group(lines, 300)?),
            truncated,
            step_counts,
            sampling_method,
            seed,
        });
    }
    let has_meta = !payload["source_attribute"].is_null();
    let rows = parse_page(array_of(&v, "rows"), has_meta)?;
    let offset = payload["offset"].as_u64().unwrap_or(0);
    let size = payload["limit"].as_u64().unwrap_or(25);
    let expected = if offset < total { (total - offset).min(size) } else { 0 };
    if rows.len() as u64 != expected {
        return remote("Unexpected workflow page length");
    }
    Ok(WorkflowResult {
        total,
        results: Some(rows),
        groups: None,
        truncated: false,
        step_counts,
        sampling_method,
        seed,
    })
}

/// Structural sanity checks for an EFCAM dependency sentence.
pub fn validate_dependency(tokens: &[SyntaxToken]) -> DependencyDiagnostics {
    let ids: Vec<&str> = tokens.iter().map(|t| t.id.as_str()).collect();
    let found: HashSet<&str> = ids.iter().copied().collect();
    let roots = tokens.iter().filter(|t| t.head == "0" && t.rel == "root").map(|t| t.id.clone()).collect();
    let is_num = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    let invalid_heads = tokens
        .iter()
        .filter(|t| is_num(&t.head) && t.head != "0" && !found.contains(t.head.as_str()))
        .map(|t| t.id.clone())
        .collect();
    let undefined = tokens.iter().filter(|t| t.head == "__UNDEF__" || t.rel == "__UNDEF__").count();
    let parents: BTreeMap<&str, &str> = tokens.iter().map(|t| (t.id.as_str(), t.head.as_str())).collect();
    let mut cycles: std::collections::BTreeSet<String> = Default::default();
    for id in &ids {
        let mut seen = HashSet::new();
        let mut current = *id;
        while let Some(parent) = parents.get(current) {
            if seen.contains(current) || !is_num(parent) || *parent == "0" {
                break;
            }
            seen.insert(current);
            current = parent;
        }
        if seen.contains(current) {
            cycles.insert(current.to_string());
        }
    }
    let sequential = ids.iter().enumerate().all(|(i, id)| *id == (i + 1).to_string());
    DependencyDiagnostics { roots, undefined, invalid_heads, cycle_nodes: cycles.into_iter().collect(), sequential }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tok(id: &str, head: &str, rel: &str) -> SyntaxToken {
        SyntaxToken { position: 0, word: String::new(), pos: String::new(), lemma: String::new(),
                      id: id.into(), head: head.into(), rel: rel.into() }
    }

    #[test]
    fn structured_concordance() {
        let s = vec![
            json!("4\t4\tthe Fulton County Grand\tJury\tsaid Friday an investigation\tA01"),
            json!("24\t24\ttook place . the\tjury\tfurther said in term-end\tA01"),
        ];
        let p = parse_page(&s, true).unwrap();
        assert_eq!(p[0].start, 4);
        assert_eq!(p[0].source.as_deref(), Some("A01"));
        assert_eq!(p.len(), 2);
        assert!(parse_page(&[json!("nonsense")], true).is_err());
    }

    #[test]
    fn frequency_and_marker() {
        let data = "CQP version 3.5.1\n61\n-::-EOL-::-\nNN1\t60\nNN2\t1\n-::-EOL-::-\n";
        let sections = parse_sections(data).unwrap();
        assert_eq!(parse_size(&sections[0]).unwrap(), 61);
        let lines: Vec<Value> = sections[1].iter().map(|s| json!(s)).collect();
        assert_eq!(parse_group(&lines, 250).unwrap()[0].count, 60);
    }

    #[test]
    fn dependency() {
        let v = validate_dependency(&[tok("1", "2", "nsubj"), tok("2", "0", "root"), tok("3", "__UNDEF__", "__UNDEF__")]);
        assert_eq!(v.roots, vec!["2"]);
        assert_eq!(v.undefined, 1);
        assert!(v.cycle_nodes.is_empty());
        assert!(v.invalid_heads.is_empty());
        assert!(v.sequential);
        assert!(!validate_dependency(&[tok("1", "2", "dep"), tok("2", "1", "dep")]).cycle_nodes.is_empty());
    }

    #[test]
    fn worker_error_surfaces() {
        let e = worker_json(r#"{"ok": false, "error": "CQP Error: boom"}"#).unwrap_err();
        assert_eq!(e.to_string(), "CQP Error: boom");
        assert!(worker_json("Traceback ...").is_err());
        let e = worker_json(r#"{"ok": false, "error": "CL: Error, unrecognised CorpusCharset in cl_string_validate_encoding."}"#).unwrap_err();
        assert!(e.to_string().contains("server configuration issue"));
    }

    #[test]
    fn search_page_length_checked() {
        let payload = json!({"offset":0,"limit":2,"source_attribute":"file_id"});
        let raw = r#"{"ok":true,"total":67,"rows":["4\t4\tl\tJury\tr\tA01"]}"#;
        assert!(decode_search(raw, &payload).is_err());
    }
}
