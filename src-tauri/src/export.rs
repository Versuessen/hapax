//! Local research outputs: CSV/TSV/JSON tables, provenance sidecars, evidence
//! notebooks, workflow plans and EFCAM syntax graphs. Nothing here touches
//! the network; nothing is ever written on the server.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{invalid, AppError, AppResult};
use crate::parse::SyntaxResult;
use crate::workflow::compile_workflow;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TableFormat { Csv, Tsv, Json }

pub fn format_for(path: &Path) -> AppResult<TableFormat> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("csv") => Ok(TableFormat::Csv),
        Some("tsv") => Ok(TableFormat::Tsv),
        Some("json") => Ok(TableFormat::Json),
        _ => invalid("Choose a .csv, .tsv or .json file name"),
    }
}

fn cell(v: Option<&Value>) -> String {
    let s = match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => if *b { "True".into() } else { "False".into() },
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    };
    // Prevent spreadsheet formula execution when the file is opened in Excel/LibreOffice.
    if s.trim_start().starts_with(['=', '+', '-', '@']) {
        format!("'{s}")
    } else {
        s
    }
}

/// `_write_export`: CSV/TSV are UTF-8 with BOM (Excel-friendly), JSON is pretty-printed.
pub fn write_table(path: &Path, rows: &[Value], columns: Option<&[String]>) -> AppResult<usize> {
    let fmt = format_for(path)?;
    if fmt == TableFormat::Json {
        std::fs::write(path, serde_json::to_string_pretty(rows)?)?;
        return Ok(rows.len());
    }
    let objects: Vec<&Map<String, Value>> = rows.iter().filter_map(Value::as_object).collect();
    let cols: Vec<String> = match columns {
        Some(c) => c.to_vec(),
        None => objects.first().map(|o| o.keys().cloned().collect()).unwrap_or_default(),
    };
    let mut buf: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    {
        let mut w = csv::WriterBuilder::new()
            .delimiter(if fmt == TableFormat::Tsv { b'\t' } else { b',' })
            .terminator(csv::Terminator::CRLF)
            .from_writer(&mut buf);
        w.write_record(&cols)?;
        for o in &objects {
            w.write_record(cols.iter().map(|c| cell(o.get(c))))?;
        }
        w.flush()?;
    }
    std::fs::write(path, buf)?;
    Ok(objects.len())
}

/// `report.csv` -> `report_provenance.json` next to it.
pub fn provenance_path(path: &Path) -> PathBuf {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
    path.with_file_name(format!("{stem}_provenance.json"))
}

pub fn write_provenance(path: &Path, data: &Value) -> AppResult<PathBuf> {
    let p = provenance_path(path);
    std::fs::write(&p, serde_json::to_string_pretty(data)?)?;
    Ok(p)
}

pub fn utc_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ---------------------------------------------------------------------------
// Evidence notebook (cqp-evidence-v1)
// ---------------------------------------------------------------------------

pub const DECISIONS: [&str; 4] = ["Unreviewed", "Relevant", "Irrelevant", "Unsure"];
pub const EVIDENCE_COLUMNS: [&str; 10] =
    ["corpus", "start", "end", "source", "left", "text", "right", "decision", "note", "query"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceRow {
    pub corpus: String,
    pub start: u64,
    pub end: u64,
    pub source: String,
    pub left: String,
    pub text: String,
    pub right: String,
    pub query: String,
    pub decision: String,
    pub note: String,
}

fn clip(v: Option<&Value>, max: usize) -> String {
    let s = match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(o) => o.to_string(),
    };
    s.chars().take(max).collect()
}

fn as_int(v: Option<&Value>) -> AppResult<i64> {
    match v {
        Some(Value::Number(n)) => n.as_i64().ok_or_else(|| AppError::Validation("Invalid token boundaries in evidence".into())),
        Some(Value::String(s)) => s.trim().parse().map_err(|_| AppError::Validation("Invalid token boundaries in evidence".into())),
        _ => invalid("Invalid token boundaries in evidence"),
    }
}

/// `clean_evidence`: bound every string, validate token span, normalize decision.
pub fn clean_evidence(item: &Value) -> AppResult<EvidenceRow> {
    let o = item.as_object().ok_or_else(|| AppError::Validation("Evidence row is not an object".into()))?;
    let (start, end) = (as_int(o.get("start"))?, as_int(o.get("end"))?);
    if start < 0 || end < start {
        return invalid("Invalid token boundaries in evidence");
    }
    let decision = clip(o.get("decision"), 64);
    Ok(EvidenceRow {
        corpus: clip(o.get("corpus"), 6000),
        start: start as u64,
        end: end as u64,
        source: clip(o.get("source"), 6000),
        left: clip(o.get("left"), 6000),
        text: clip(o.get("text"), 6000),
        right: clip(o.get("right"), 6000),
        query: clip(o.get("query"), 6000),
        decision: if DECISIONS.contains(&decision.as_str()) { decision } else { "Unreviewed".into() },
        note: clip(o.get("note"), 4000),
    })
}

fn evidence_key(r: &EvidenceRow) -> (String, u64, u64) {
    (r.corpus.clone(), r.start, r.end)
}

/// Add concordance rows to a notebook, skipping spans already present.
pub fn merge_evidence(existing: Vec<EvidenceRow>, corpus: &str, rows: &[Value], query: &Value) -> AppResult<(Vec<EvidenceRow>, usize)> {
    let mut out = existing;
    let mut seen: std::collections::HashSet<_> = out.iter().map(evidence_key).collect();
    let query_text = serde_json::to_string(query)?;
    let before = out.len();
    for row in rows {
        let mut obj = row.as_object().cloned().unwrap_or_default();
        obj.insert("corpus".into(), json!(corpus));
        obj.insert("decision".into(), json!("Unreviewed"));
        obj.insert("note".into(), json!(""));
        obj.insert("query".into(), json!(query_text));
        let rec = clean_evidence(&Value::Object(obj))?;
        if seen.insert(evidence_key(&rec)) {
            out.push(rec);
        }
    }
    let added = out.len() - before;
    Ok((out, added))
}

pub fn save_evidence(path: &Path, rows: &[EvidenceRow]) -> AppResult<()> {
    let doc = json!({
        "format": "cqp-evidence-v1",
        "saved_utc": utc_now(),
        "notes": "Evidence judgments are made by the researcher, not automatically assigned.",
        "rows": rows,
    });
    std::fs::write(path, serde_json::to_string_pretty(&doc)?)?;
    Ok(())
}

pub fn open_evidence(path: &Path) -> AppResult<Vec<EvidenceRow>> {
    if std::fs::metadata(path)?.len() > 4_000_000 {
        return invalid("Notebook larger than 4 MB");
    }
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    if doc.get("format").and_then(Value::as_str) != Some("cqp-evidence-v1") {
        return invalid("Not a CQP evidence notebook");
    }
    let rows = doc.get("rows").and_then(Value::as_array).ok_or_else(|| AppError::Validation("Notebook has no rows".into()))?;
    if rows.len() > 5000 {
        return invalid("Notebook must have at most 5,000 examples");
    }
    // Deduplicate by span; a later duplicate replaces the earlier one in place.
    let mut out: Vec<EvidenceRow> = Vec::new();
    let mut index: HashMap<(String, u64, u64), usize> = HashMap::new();
    for item in rows {
        let rec = clean_evidence(item)?;
        match index.get(&evidence_key(&rec)) {
            Some(&i) => out[i] = rec,
            None => {
                index.insert(evidence_key(&rec), out.len());
                out.push(rec);
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Workflow plan files (cqp-explorer-workflow-v1)
// ---------------------------------------------------------------------------

pub fn save_workflow(path: &Path, plan: &Value) -> AppResult<()> {
    compile_workflow(plan)?; // never write an invalid plan
    let doc = json!({ "format": "cqp-explorer-workflow-v1", "plan": plan });
    std::fs::write(path, serde_json::to_string_pretty(&doc)?)?;
    Ok(())
}

pub fn load_workflow(path: &Path) -> AppResult<Value> {
    if std::fs::metadata(path)?.len() > 128_000 {
        return invalid("Workflow file exceeds 128 KB limit");
    }
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let plan = raw.get("plan").cloned().ok_or_else(|| AppError::Validation("File has no workflow plan".into()))?;
    compile_workflow(&plan)?;
    Ok(plan)
}

// ---------------------------------------------------------------------------
// EFCAM syntax export
// ---------------------------------------------------------------------------

pub fn syntax_dot(data: &SyntaxResult) -> String {
    let mut lines = vec!["digraph EFCAM {".to_string(), "  rankdir=TB;".into(), "  node [shape=box];".into()];
    for t in &data.tokens {
        let label = serde_json::to_string(&format!("{} ({})", t.word, t.id)).unwrap_or_default();
        lines.push(format!("  n{} [label={label}];", t.id));
        if !t.head.is_empty() && t.head.chars().all(|c| c.is_ascii_digit()) && t.head != "0" {
            let rel = serde_json::to_string(&t.rel).unwrap_or_default();
            lines.push(format!("  n{} -> n{} [label={rel}];", t.head, t.id));
        }
    }
    lines.push("}".into());
    lines.join("\n")
}

pub fn write_syntax(path: &Path, data: &SyntaxResult) -> AppResult<()> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("json") => std::fs::write(path, serde_json::to_string_pretty(data)?)?,
        Some("dot") | Some("gv") => std::fs::write(path, syntax_dot(data))?,
        _ => return invalid("Choose a .json or .dot file name"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_formula_guard_and_bom() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.csv");
        let rows = vec![json!({"value":"=SUM(A1)","count":3}), json!({"value":"ok","count":1})];
        write_table(&p, &rows, Some(&["value".into(), "count".into()])).unwrap();
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        let text = String::from_utf8(bytes[3..].to_vec()).unwrap();
        assert!(text.starts_with("value,count\r\n'=SUM(A1),3\r\n"));
        assert_eq!(provenance_path(&p).file_name().unwrap(), "t_provenance.json");
    }

    #[test]
    fn evidence_roundtrip_and_dedupe() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("n.json");
        let rows = vec![json!({"start":4,"end":4,"left":"l","text":"Jury","right":"r","source":"A01"})];
        let (nb, added) = merge_evidence(vec![], "BROWN-LEGACY", &rows, &json!({"value":"jury"})).unwrap();
        assert_eq!(added, 1);
        let (nb, added) = merge_evidence(nb, "BROWN-LEGACY", &rows, &json!({})).unwrap();
        assert_eq!(added, 0);
        save_evidence(&p, &nb).unwrap();
        assert_eq!(open_evidence(&p).unwrap(), nb);
        assert!(clean_evidence(&json!({"start":5,"end":2})).is_err());
    }
}
