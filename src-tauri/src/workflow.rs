//! Validated composable query plans (port of workflow_core.py).
//!
//! The plan arrives as loose JSON (it is also the on-disk
//! `cqp-explorer-workflow-v1` format), is validated step by step exactly like
//! the Python code, and is re-emitted in a normalized shape for the worker.

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::corpora;
use crate::error::{invalid, AppResult};
use crate::query::{
    build_query, group_anchor, py_repr, py_title, thousands,
    thousands_2dp, QuerySpec,
};

pub const MAX_STEPS: usize = 12;
const OPERATIONS: [&str; 3] = ["union", "intersection", "difference"];

#[derive(Debug, Clone, Serialize)]
pub struct CompiledWorkflow {
    pub script: String,
    pub result_name: String,
    pub summaries: Vec<String>,
    /// The plan normalized to explicit integers/defaults (what the worker reads).
    pub plan: Value,
}

fn str_field<'a>(obj: &'a Map<String, Value>, key: &str, default: &'a str) -> &'a str {
    obj.get(key).and_then(Value::as_str).unwrap_or(default)
}

fn bool_field(obj: &Map<String, Value>, key: &str) -> bool {
    // Python truthiness for the values the GUI can produce.
    match obj.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        _ => false,
    }
}

/// `_index`: a reference to an earlier step (1-based), accepts ints or numeric strings.
fn step_index(value: Option<&Value>, upper: usize) -> AppResult<usize> {
    let raw = match value {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    };
    let Some(idx) = raw else { return invalid("Choose a valid earlier step") };
    if idx < 1 || idx as usize >= upper {
        let shown = value.map(|v| match v { Value::String(s) => s.clone(), o => o.to_string() }).unwrap_or_default();
        return invalid(format!("Reference {shown} must point to an earlier step"));
    }
    Ok(idx as usize)
}


/// Parse a step's `query` object (loose JSON) into a `QuerySpec`.
fn query_from(value: Option<&Value>, corpus: &str) -> AppResult<QuerySpec> {
    let mut spec: QuerySpec = match value {
        None | Some(Value::Null) => QuerySpec::default(),
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|e| crate::error::AppError::Validation(format!("Invalid search step: {e}")))?,
    };
    spec.corpus = corpus.to_string();
    Ok(spec)
}

pub fn compile_workflow(plan: &Value) -> AppResult<CompiledWorkflow> {
    let Some(plan_obj) = plan.as_object() else {
        return invalid("Choose a known corpus for the workflow");
    };
    let corpus = str_field(plan_obj, "corpus", "");
    if !corpora::all().contains_key(corpus) {
        return invalid("Choose a known corpus for the workflow");
    }
    let steps = match plan_obj.get("steps").and_then(Value::as_array) {
        Some(s) if (1..=MAX_STEPS).contains(&s.len()) => s,
        _ => return invalid(format!("A workflow needs 1–{MAX_STEPS} steps")),
    };
    let bnc = corpus == "BNC" || corpus == "BNC-BABY";
    let mut commands = vec!["set PrettyPrint off;".to_string(), format!("{corpus};")];
    let mut summaries = Vec::new();
    let mut normalized = Vec::new();

    for (i, step) in steps.iter().enumerate() {
        let idx = i + 1;
        let Some(step) = step.as_object() else {
            return invalid(format!("Step {idx} is not an object"));
        };
        let name = format!("Q{idx}");
        match step.get("kind").and_then(Value::as_str) {
            Some("search") => {
                let request = query_from(step.get("query"), corpus)?;
                if bnc && request.field == "lemma" && !request.value.contains('_') && !request.regex {
                    return invalid(format!(
                        "In {corpus}, lemma values include a grammatical suffix (for example go_VERB). \
                         For {} and its inflected forms, select 'lexeme' instead. Use 'lemma' only when \
                         specifying the full indexed annotation.",
                        py_repr(&request.value)
                    ));
                }
                let compiled = build_query(&request)?;
                commands.push(format!("{name} = {};", compiled.expression));
                let extra = if !crate::query::followers(&request).is_empty() || !request.meta_value.is_empty() {
                    " with additional conditions"
                } else {
                    ""
                };
                summaries.push(format!("{idx}. Find {} = {}{extra}", compiled.field, py_repr(&request.value)));
                let mut q = serde_json::to_value(&request)?;
                if let Some(o) = q.as_object_mut() { o.remove("corpus"); }
                normalized.push(json!({ "kind": "search", "query": q }));
            }
            Some("refine") => {
                let source = step_index(step.get("source"), idx)?;
                let raw_field = str_field(step, "field", "word");
                let field = corpora::resolve_field(corpus, raw_field)?;
                let raw_value = str_field(step, "value", "");
                if bnc && raw_field == "lemma" && !raw_value.contains('_') {
                    return invalid(format!(
                        "In {corpus}, the lemma attribute contains labels such as disaster_SUBST. \
                         Use 'lexeme' for ordinary headword filtering."
                    ));
                }
                let value = crate::query::literal_alternatives(raw_value)?;
                let anchor = str_field(step, "anchor", "match");
                if anchor != "match" && anchor != "matchend" {
                    return invalid("Refine location must be the first or last token of the match");
                }
                let mode = str_field(step, "mode", "keep");
                if mode != "keep" && mode != "exclude" {
                    return invalid("Refine mode must be keep or exclude");
                }
                let ignore_case = bool_field(step, "ignore_case");
                let foldable = ["word", "hw", "lemma"].contains(&field.as_str());
                let flag = if ignore_case && foldable { " %c" } else { "" };
                if ignore_case && flag.is_empty() {
                    return invalid("Ignore-case is not available for that attribute");
                }
                let clause = format!("[{field}=\"{value}\"{flag}]");
                if mode == "keep" {
                    commands.push(format!("{name} = subset Q{source} where {anchor}: {clause};"));
                } else {
                    commands.push(format!("R{idx} = subset Q{source} where {anchor}: {clause};"));
                    commands.push(format!("{name} = difference Q{source} R{idx};"));
                }
                let case_note = if flag.is_empty() { " (case-sensitive)" } else { " (case-insensitive)" };
                summaries.push(format!(
                    "{idx}. {} matches from step {source} when {anchor} {field} = {}{case_note}",
                    py_title(mode),
                    py_repr(raw_value)
                ));
                normalized.push(json!({
                    "kind": "refine", "source": source, "field": raw_field, "value": raw_value,
                    "anchor": anchor, "mode": mode, "ignore_case": ignore_case,
                }));
            }
            Some("combine") => {
                let left = step_index(step.get("left"), idx)?;
                let right = step_index(step.get("right"), idx)?;
                let method = str_field(step, "method", "");
                if !OPERATIONS.contains(&method) {
                    return invalid("Select Union, Intersection, or Difference");
                }
                commands.push(format!("{name} = {method} Q{left} Q{right};"));
                summaries.push(format!(
                    "{idx}. {} results of steps {left} and {right} (exact match spans)",
                    py_title(method)
                ));
                normalized.push(json!({ "kind": "combine", "left": left, "right": right, "method": method }));
            }
            other => {
                let shown = match other { Some(k) => py_repr(k), None => "None".into() };
                return invalid(format!("Unknown type of step {idx}: {shown}"));
            }
        }
    }
    Ok(CompiledWorkflow {
        script: commands.join("\n") + "\n",
        result_name: format!("Q{}", steps.len()),
        summaries,
        plan: json!({ "corpus": corpus, "steps": normalized }),
    })
}

#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct WorkflowRequest {
    pub plan: Value,
    /// results | group | export | sample
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub offset: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default = "default_context")]
    pub context: i64,
    #[serde(default)]
    pub seed: Option<i64>,
    #[serde(default)]
    pub group_field: Option<String>,
    #[serde(default)]
    pub group_position: Option<String>,
}
fn default_mode() -> String { "results".into() }
fn default_limit() -> i64 { 25 }
fn default_context() -> i64 { 4 }

/// `validate_workflow_request` -> the worker payload.
pub fn workflow_payload(req: &WorkflowRequest) -> AppResult<Value> {
    let compiled = compile_workflow(&req.plan)?;
    let mode = req.mode.as_str();
    let max_limit = match mode { "export" => 5000, "sample" => 150, _ => 100 };
    if !(0..=1_000_000_000).contains(&req.offset)
        || !(1..=max_limit).contains(&req.limit)
        || ![2, 4, 6, 10].contains(&req.context)
    {
        return invalid(format!("Invalid range; choose 1–{max_limit} matches for this operation"));
    }
    if !["results", "group", "export", "sample"].contains(&mode) {
        return invalid("Unknown workflow result mode");
    }
    let mut seed = Value::Null;
    if mode == "sample" {
        let s = req.seed.unwrap_or(42);
        if !(0..=2_147_483_647).contains(&s) {
            return invalid("Random seed must be between 0 and 2,147,483,647");
        }
        seed = json!(s);
    }
    let corpus = compiled.plan["corpus"].as_str().unwrap_or_default().to_string();
    let mut group_field = Value::Null;
    let mut anchor = "match";
    if mode == "group" {
        anchor = group_anchor(req.group_position.as_deref().unwrap_or("first"))?;
        let gf = corpora::resolve_field(&corpus, req.group_field.as_deref().unwrap_or("pos"))?;
        if !["word", "pos", "class", "lemma", "hw", "rel", "usas"].contains(&gf.as_str()) {
            return invalid("Unsupported grouping field");
        }
        group_field = json!(gf);
    }
    // Random samples always start at the first row of the shuffled result.
    let offset = if mode == "sample" { 0 } else { req.offset };
    Ok(json!({
        "op": "workflow",
        "plan": compiled.plan,
        "mode": mode,
        "script": compiled.script,
        "result_name": compiled.result_name,
        "summaries": compiled.summaries,
        "source_attribute": corpora::source_attribute(&corpus),
        "group_field": group_field,
        "group_anchor": anchor,
        "offset": offset,
        "limit": req.limit,
        "context": req.context,
        "seed": seed,
    }))
}

/// `explain_workflow` — plain-language summary after a run.
pub fn explain_workflow(plan: &Value, total: u64, corpus_tokens: u64) -> AppResult<String> {
    let compiled = compile_workflow(plan)?;
    let rate = if corpus_tokens > 0 { total as f64 * 1_000_000.0 / corpus_tokens as f64 } else { 0.0 };
    Ok(format!(
        "Your workflow has {} steps and found {} matching spans in {}. That is {} matching spans per \
         million indexed corpus tokens (including punctuation). This is a corpus-wide rate, not a rate \
         within a filtered subset. Set operations compare exact matched token ranges—not documents or \
         sentences. Look at contexts to check ambiguity before interpreting the count. Export the \
         workflow JSON and provenance alongside your research notes.",
        compiled.summaries.len(),
        thousands(total),
        compiled.plan["corpus"].as_str().unwrap_or_default(),
        thousands_2dp(rate)
    ))
}

/// `interpretation` — plain-language summary after a single search.
pub fn interpretation(query: &QuerySpec, total: u64, tokens: u64) -> String {
    let rate = if tokens > 0 { total as f64 * 1_000_000.0 / tokens as f64 } else { 0.0 };
    let hint = match query.field.as_str() {
        "word" => "This counts written forms, not necessarily every grammatical form of the word.",
        "lexeme" => "This combines the indexed forms of a headword/lemma; inspect context for multiple senses.",
        "pos" => "These are annotation labels produced by the corpus tagger, not manual judgments.",
        "class" => "These are the corpus's own broad word classes, which may differ from textbook categories.",
        _ => "This matches indexed annotations, whose conventions vary by corpus.",
    };
    let caveat = if !query.meta_attr.is_empty() && !query.meta_value.is_empty() {
        "A metadata filter is active: the rate below uses the entire corpus denominator and must NOT be \
         treated as a within-group frequency. Load metadata sizes under Corpora > Contents & metadata (or use Spread across texts) before making \
         subgroup comparisons. "
    } else {
        ""
    };
    format!(
        "Found {} matches for {} by {}. Corpus-wide reference rate: {} matches per million indexed tokens. \
         {caveat}{hint} Next: read several examples, then use Count by annotation to see how they are used, or \
         Combine searches to narrow them down.",
        thousands(total),
        py_repr(&query.value),
        query.field,
        thousands_2dp(rate)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> Value {
        json!({"corpus":"BROWN-LEGACY","steps":[
            {"kind":"search","query":{"field":"word","value":"jury","ignore_case":true}},
            {"kind":"refine","source":1,"field":"pos","value":"NN","mode":"keep","anchor":"match"},
            {"kind":"search","query":{"field":"word","value":"court","ignore_case":true}},
            {"kind":"combine","left":2,"right":3,"method":"union"}]})
    }

    #[test]
    fn script_and_names() {
        let c = compile_workflow(&plan()).unwrap();
        assert!(c.script.contains("Q1 = [word=\"jury\" %c];"));
        assert!(c.script.contains("Q2 = subset Q1 where match: [pos=\"NN\"];"));
        assert!(c.script.contains("Q4 = union Q2 Q3;"));
        assert_eq!(c.result_name, "Q4");
        assert_eq!(c.summaries.len(), 4);
        let req = WorkflowRequest {
            plan: plan(), mode: "results".into(), offset: 0, limit: 5, context: 4,
            seed: None, group_field: None, group_position: None,
        };
        assert_eq!(workflow_payload(&req).unwrap()["source_attribute"], "file_id");
    }

    #[test]
    fn rejects_invalid_steps() {
        let first = plan()["steps"][0].clone();
        for bad in [
            json!({"kind":"combine","left":2,"right":999,"method":"union"}),
            json!({"kind":"refine","source":1,"field":"pos","value":"NN","mode":"keep","anchor":"bogus"}),
            json!({"kind":"search","query":{"field":"word","value":"a\";exit;"}}),
        ] {
            let p = json!({"corpus":"BROWN-LEGACY","steps":[first.clone(), bad.clone()]});
            assert!(compile_workflow(&p).is_err(), "{bad}");
        }
        let thirteen: Vec<Value> = (0..13).map(|_| first.clone()).collect();
        assert!(compile_workflow(&json!({"corpus":"BNC","steps":thirteen})).is_err());
        assert!(compile_workflow(&json!({"corpus":"BROWN-LEGACY","steps":[]})).is_err());
    }

    #[test]
    fn exclusion_generation() {
        let p = json!({"corpus":"BROWN-LEGACY","steps":[
            {"kind":"search","query":{"field":"word","value":"jury"}},
            {"kind":"refine","source":1,"field":"word","value":"JURY","mode":"exclude","anchor":"matchend","ignore_case":false}]});
        let c = compile_workflow(&p).unwrap();
        assert!(c.script.contains("R2 = subset Q1 where matchend: [word=\"JURY\"];"));
        assert!(c.script.contains("Q2 = difference Q1 R2;"));
    }

    #[test]
    fn following_token_plan() {
        let p = json!({"corpus":"BNC-BABY","steps":[{"kind":"search","query":
            {"field":"lexeme","value":"deliver","second_field":"class","second_value":"ADV","gap":0,"sentence_only":true}}]});
        let c = compile_workflow(&p).unwrap();
        assert!(c.script.contains("[hw=\"deliver\"] [class=\"ADV\"] within s"));
        assert_eq!(c.result_name, "Q1");
        for bad in ["matchend;exit", "", "../../etc"] {
            let r = WorkflowRequest {
                plan: p.clone(), mode: "group".into(), offset: 0, limit: 10, context: 4, seed: None,
                group_field: Some("word".into()), group_position: Some(bad.into()),
            };
            assert!(workflow_payload(&r).is_err());
        }
    }

    #[test]
    fn bnc_lemma_guard() {
        let p = json!({"corpus":"BNC","steps":[{"kind":"search","query":{"field":"lemma","value":"disaster"}}]});
        assert!(compile_workflow(&p).unwrap_err().to_string().contains("select 'lexeme' instead"));
    }

    #[test]
    fn scientific_caveats() {
        let q = QuerySpec { field: "word".into(), value: "jury".into(), meta_attr: "file_id".into(),
                            meta_value: "A01".into(), ..Default::default() };
        let t = interpretation(&q, 5, 1000);
        assert!(t.contains("NOT be treated as a within-group"));
        assert!(t.contains("indexed tokens"));
        assert!(t.contains("5,000.00"));
        assert!(explain_workflow(&plan(), 5, 1000).unwrap().contains("exact"));
    }
}
