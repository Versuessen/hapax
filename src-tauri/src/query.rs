//! Structured query validation and CQP compilation (port of cqp_core.py).
//!
//! Security model is unchanged from the Python app: the GUI never sends raw
//! CQP. It sends a structured `QuerySpec`; this module validates every field
//! against the corpus inventory and an allow-list, then emits the expression.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::corpora::{self, SEARCH_LIMIT};
use crate::error::{invalid, AppResult};

/// Trusted CQP group selectors. GUI text can never become an arbitrary anchor.
pub const GROUP_ANCHORS: [(&str, &str); 4] = [
    ("first", "match"),
    ("last", "matchend"),
    ("before", "match[-1]"),
    ("after", "matchend[1]"),
];

pub const GROUP_LABELS: [(&str, &str); 4] = [
    ("First matched token", "first"),
    ("Last matched token", "last"),
    ("Immediately before match", "before"),
    ("Immediately after match", "after"),
];

pub const CONTEXT_SIZES: [u32; 4] = [2, 4, 6, 10];
const GROUPABLE: [&str; 7] = ["word", "pos", "class", "lemma", "hw", "rel", "usas"];
const CASE_FOLDABLE: [&str; 3] = ["word", "lemma", "hw"];

pub fn group_anchor(position: &str) -> AppResult<&'static str> {
    GROUP_ANCHORS
        .iter()
        .find(|(k, _)| *k == position)
        .map(|(_, v)| *v)
        .ok_or_else(|| crate::error::AppError::Validation(
            "Choose a supported token position for frequency counting".into(),
        ))
}

/// The search form. Field names match the Python request dicts exactly, so
/// saved searches from the v3 `preferences.json` deserialize unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct QuerySpec {
    pub corpus: String,
    pub field: String,
    pub value: String,
    pub regex: bool,
    pub ignore_case: bool,
    pub second_field: String,
    pub second_value: String,
    pub gap: i64,
    pub sentence_only: bool,
    pub meta_attr: String,
    pub meta_value: String,
    /// Further words of the sequence (after `second_*`, which is kept so older
    /// saved searches and workflow files load unchanged).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub next: Vec<NextToken>,
    /// Document filters, all of which must hold (AND). The legacy single
    /// `meta_attr`/`meta_value` pair still works and is applied first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub filters: Vec<MetaFilter>,
}

/// One document/region filter on a structural attribute with values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct MetaFilter {
    pub attr: String,
    /// "is" (value; `|` separates alternatives) | "not" | "years" (from/to).
    pub op: String,
    pub value: String,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

pub const MAX_FILTERS: usize = 6;
/// Alternatives in one filter value (picked from a value list, so more than for words).
const MAX_FILTER_VALUES: usize = 200;

/// The query's filters in the structured form the worker uses to measure a
/// filtered subcorpus (`kept_regions` in worker.py). Same semantics as the CQP
/// constraints: exact values, `not`, and years matched at the start of the value.
pub fn filter_spec(q: &QuerySpec) -> Vec<Value> {
    let mut out = Vec::new();
    let mv = q.meta_value.trim();
    if !q.meta_attr.is_empty() && !mv.is_empty() {
        out.push(json!({ "attr": q.meta_attr, "op": "is", "values": [mv] }));
    }
    for f in q.filters.iter().filter(|f| !f.attr.is_empty()) {
        match f.op.as_str() {
            "years" => out.push(json!({ "attr": f.attr, "op": "years", "from": f.from.unwrap_or(1000), "to": f.to.unwrap_or(2100) })),
            op => {
                let values: Vec<&str> = f.value.split('|').map(str::trim).filter(|v| !v.is_empty()).collect();
                out.push(json!({ "attr": f.attr, "op": if op == "not" { "not" } else { "is" }, "values": values }));
            }
        }
    }
    out
}

/// Compile one filter into a CQP global-constraint term on `match.<attr>`.
/// Values are matched literally; a year range becomes an alternation of the
/// years it covers, anchored at the start of the stored value, so "1985-1993"
/// counts as 1985 and non-numeric values never match. (No `int()`: it fails on
/// values like "1985-1993".)
pub fn filter_constraint(f: &MetaFilter, corpus: &str) -> AppResult<String> {
    let info = corpora::get(corpus)?;
    if !info.metadata.iter().any(|m| m == &f.attr) {
        return invalid(format!("{corpus} has no metadata attribute '{}'", f.attr));
    }
    let attr = &f.attr;
    let values = |raw: &str| -> AppResult<String> {
        let parts: Vec<&str> = raw.split('|').map(str::trim).filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            return invalid(format!("Filter on {attr}: enter a value"));
        }
        if parts.len() > MAX_FILTER_VALUES {
            return invalid(format!("Filter on {attr}: at most {MAX_FILTER_VALUES} values"));
        }
        let mut out = Vec::new();
        for p in parts {
            out.push(escape_regex_literal(&clean_meta_value(p)?));
        }
        Ok(if out.len() == 1 { out.remove(0) } else { format!("({})", out.join("|")) })
    };
    match f.op.as_str() {
        "is" | "" => Ok(format!("match.{attr}=\"{}\"", values(&f.value)?)),
        "not" => Ok(format!("match.{attr}!=\"{}\"", values(&f.value)?)),
        "years" => {
            let (from, to) = (f.from.unwrap_or(1000), f.to.unwrap_or(2100));
            if !(1000..=2100).contains(&from) || !(1000..=2100).contains(&to) || from > to {
                return invalid(format!("Filter on {attr}: enter a year range between 1000 and 2100, earliest first"));
            }
            if to - from > 400 {
                return invalid(format!("Filter on {attr}: a year range can span at most 400 years"));
            }
            let years: Vec<String> = (from..=to).map(|y| y.to_string()).collect();
            Ok(format!("match.{attr}=\"({}).*\"", years.join("|")))
        }
        other => invalid(format!("Unknown filter type '{other}'")),
    }
}

/// One more word in a multi-word sequence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct NextToken {
    pub field: String,
    pub value: String,
    /// Up to this many other words may come before it (0 = directly after).
    pub gap: i64,
    /// The word may be missing (`[...]?`). Not allowed on the last word.
    pub optional: bool,
}

impl Default for NextToken {
    fn default() -> Self {
        Self { field: "word".into(), value: String::new(), gap: 0, optional: false }
    }
}

/// Words after the first, at most this many.
pub const MAX_NEXT: usize = 8;
/// Alternatives per word (`I|me`), at most this many.
const MAX_ALTERNATIVES: usize = 12;

impl Default for QuerySpec {
    fn default() -> Self {
        Self {
            corpus: String::new(),
            field: "word".into(),
            value: String::new(),
            regex: false,
            ignore_case: false,
            second_field: "word".into(),
            second_value: String::new(),
            gap: 0,
            sentence_only: false,
            meta_attr: String::new(),
            meta_value: String::new(),
            next: Vec::new(),
            filters: Vec::new(),
        }
    }
}

fn has_forbidden_char(value: &str) -> bool {
    value.chars().any(|ch| (ch as u32) < 32 || ch == '"' || ch == '\\' || ch == ';')
}

pub fn clean_value(value: &str, regex: bool) -> AppResult<String> {
    let n = value.chars().count();
    if !(1..=120).contains(&n) {
        return invalid("Search values must contain 1–120 characters");
    }
    if has_forbidden_char(value) {
        return invalid(
            "Search values may not contain quotation marks, backslashes, semicolons or control characters",
        );
    }
    if regex && n > 80 {
        return invalid("Regex patterns are limited to 80 characters");
    }
    Ok(value.to_string())
}

/// Ordinary GUI queries are literal values, not CQP regular expressions.
pub fn escape_regex_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        if ".[]{}()*+?^$|".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

pub fn clean_meta_value(value: &str) -> AppResult<String> {
    if value.is_empty() || value.chars().count() > 150 || has_forbidden_char(value) {
        return invalid("Metadata value contains unsafe characters or is too long");
    }
    Ok(value.to_string())
}

/// A literal value where `|` separates alternatives: `I|me` -> `(I|me)`.
/// Each alternative is escaped, so nothing else is ever a regex operator.
pub fn literal_alternatives(value: &str) -> AppResult<String> {
    let value = clean_value(value.trim(), false)?;
    if !value.contains('|') {
        return Ok(escape_regex_literal(&value));
    }
    let parts: Vec<&str> = value.split('|').map(str::trim).collect();
    if parts.iter().any(|p| p.is_empty()) {
        return invalid("Alternatives need a word on both sides of | (for example I|me)");
    }
    if parts.len() > MAX_ALTERNATIVES {
        return invalid(format!("At most {MAX_ALTERNATIVES} alternatives per word"));
    }
    Ok(format!("({})", parts.iter().map(|p| escape_regex_literal(p)).collect::<Vec<_>>().join("|")))
}

/// All words after the first, in order: legacy `second_*` first, then `next`.
pub fn followers(q: &QuerySpec) -> Vec<NextToken> {
    let mut out = Vec::new();
    if !q.second_value.trim().is_empty() {
        out.push(NextToken { field: q.second_field.clone(), value: q.second_value.clone(), gap: q.gap, optional: false });
    }
    out.extend(q.next.iter().filter(|t| !t.value.trim().is_empty()).cloned());
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledQuery {
    pub corpus: String,
    pub expression: String,
    /// Resolved positional attribute of the first token (e.g. lexeme -> hw).
    pub field: String,
}

impl CompiledQuery {
    /// Exactly what the Python "Preview CQP" dialog showed.
    pub fn cqp_command(&self) -> String {
        format!("{};\nGUIQuery = {};", self.corpus, self.expression)
    }
}

/// `build_query` from cqp_core.py — byte-for-byte identical output.
pub fn build_query(q: &QuerySpec) -> AppResult<CompiledQuery> {
    build_query_marked(q, None)
}

/// As `build_query`, with CQP's target marker `@` on word `target` (1-based),
/// so that `group … target …` can count any word of a sequence.
pub fn build_query_marked(q: &QuerySpec, target: Option<usize>) -> AppResult<CompiledQuery> {
    let info = match corpora::all().get(&q.corpus) {
        Some(i) => i,
        None => return invalid("Unknown corpus"),
    };
    corpora::ensure_queryable(&q.corpus)?;
    let field = corpora::resolve_field(&q.corpus, &q.field)?;
    let mut value = clean_value(&q.value, q.regex)?;
    let flag = if q.ignore_case { " %c" } else { "" };
    if q.ignore_case && !CASE_FOLDABLE.contains(&field.as_str()) {
        return invalid("Case folding is supported for word, lemma and headword searches");
    }
    if !q.regex {
        value = literal_alternatives(&value)?;
    }
    let mark = |n: usize| if target == Some(n) { "@" } else { "" };
    let mut expression = format!("{}[{field}=\"{value}\"{flag}]", mark(1));

    let rest = followers(q);
    if let Some(t) = target {
        if t < 1 || t > rest.len() + 1 {
            return invalid(format!("The search has {} words; there is no word {t}", rest.len() + 1));
        }
    }
    if rest.len() > MAX_NEXT {
        return invalid(format!("A sequence can have at most {} words", MAX_NEXT + 1));
    }
    for (i, t) in rest.iter().enumerate() {
        let word_no = i + 2;
        let f = corpora::resolve_field(&q.corpus, &t.field)?;
        let v = literal_alternatives(&t.value)
            .map_err(|e| crate::error::AppError::Validation(format!("Word {word_no}: {e}")))?;
        if !(0..=10).contains(&t.gap) {
            return invalid(format!("Word {word_no}: the gap must be between 0 and 10 words"));
        }
        if t.optional && i + 1 == rest.len() {
            return invalid(format!(
                "Word {word_no} is the last word, so it can't be optional (CQP would always leave it out). Remove it instead."
            ));
        }
        let fl = if q.ignore_case && CASE_FOLDABLE.contains(&f.as_str()) { " %c" } else { "" };
        if t.gap > 0 {
            expression.push_str(&format!(" []{{0,{}}}", t.gap));
        }
        let opt = if t.optional { "?" } else { "" };
        expression.push_str(&format!(" {}[{f}=\"{v}\"{fl}]{opt}", mark(word_no)));
    }
    if q.sentence_only {
        if !info.structural.contains_key("s") {
            return invalid("This corpus has no sentence structural attribute");
        }
        expression.push_str(" within s");
    }
    let mut constraints = Vec::new();
    let mv = q.meta_value.trim();
    if !q.meta_attr.is_empty() && !mv.is_empty() {
        if !info.metadata.iter().any(|m| m == &q.meta_attr) {
            return invalid("Unknown corpus metadata field");
        }
        clean_meta_value(mv)?;
        constraints.push(format!("match.{}=\"{}\"", q.meta_attr, mv));
    }
    let active: Vec<&MetaFilter> = q.filters.iter().filter(|f| !f.attr.is_empty()).collect();
    if active.len() > MAX_FILTERS {
        return invalid(format!("At most {MAX_FILTERS} document filters"));
    }
    for f in active {
        constraints.push(filter_constraint(f, &q.corpus)?);
    }
    if !constraints.is_empty() {
        // Legacy single filter alone keeps its exact v3 form: ` :: match.a="v"`.
        expression.push_str(&format!(" :: {}", constraints.join(" & ")));
    }
    Ok(CompiledQuery { corpus: q.corpus.clone(), expression, field })
}

// ---------------------------------------------------------------------------
// Operation requests coming from the frontend
// ---------------------------------------------------------------------------

fn default_limit() -> u32 { 25 }
fn default_context() -> u32 { 4 }
fn default_sample() -> u32 { 100 }
fn default_position() -> String { "first".into() }

/// Concordance page (`op=search`) or capped bulk export (`op=export`).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchRequest {
    #[serde(flatten)]
    pub query: QuerySpec,
    #[serde(default)]
    pub offset: u64,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default = "default_context")]
    pub context: u32,
    /// "" (corpus order) | match | left | right — see SORT_KEYS.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sort: String,
}

/// Trusted concordance sort keys -> CQP sort commands (run before tabulate).
pub const SORT_KEYS: [(&str, &str); 3] = [
    ("match", "sort GUIQuery by word %cd;"),
    ("left", "sort GUIQuery by word %cd on match[-1];"),
    ("right", "sort GUIQuery by word %cd on matchend[1];"),
];

pub fn sort_command(key: &str) -> AppResult<Option<&'static str>> {
    if key.is_empty() || key == "none" {
        return Ok(None);
    }
    SORT_KEYS.iter().find(|(k, _)| *k == key).map(|(_, c)| Some(*c))
        .ok_or_else(|| crate::error::AppError::Validation("Unsupported sort order".into()))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FrequencyRequest {
    #[serde(flatten)]
    pub query: QuerySpec,
    pub group_field: String,
    /// first | last | before | after
    #[serde(default = "default_position")]
    pub group_position: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CollocateRequest {
    #[serde(flatten)]
    pub query: QuerySpec,
    #[serde(default = "default_sample")]
    pub sample_limit: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CompareRequest {
    pub corpora: Vec<String>,
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub ignore_case: bool,
    /// Full search (sequences, alternatives, sentence limit) run in every corpus.
    /// Its `corpus` and document filter are ignored: metadata differs per corpus.
    #[serde(default)]
    pub query: Option<QuerySpec>,
    /// Document filters per corpus (metadata differs between corpora). Rates for
    /// a filtered corpus divide by the size of the filtered part.
    #[serde(default)]
    pub filters: std::collections::BTreeMap<String, Vec<MetaFilter>>,
}

pub const MAX_COMPARE: usize = 6;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LexiconRequest {
    pub corpus: String,
    pub field: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MetadataRequest {
    pub corpus: String,
    pub attribute: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SyntaxRequest {
    #[serde(default = "efcam")]
    pub corpus: String,
    pub position: i64,
}
fn efcam() -> String { "EFCAM".into() }

// ---------------------------------------------------------------------------
// Worker payloads: the exact JSON the (unchanged) remote Python worker reads
// ---------------------------------------------------------------------------

pub fn search_payload(r: &SearchRequest, export: bool) -> AppResult<Value> {
    let compiled = build_query(&r.query)?;
    let max = if export { SEARCH_LIMIT } else { 100 };
    if r.offset > 1_000_000_000 || !(1..=max).contains(&r.limit) {
        return invalid("Invalid result range");
    }
    if !CONTEXT_SIZES.contains(&r.context) {
        return invalid("Invalid concordance context");
    }
    let sort = sort_command(&r.sort)?;
    let mut payload = json!({
        "op": if export { "export" } else { "search" },
        "corpus": compiled.corpus,
        "expression": compiled.expression,
        "offset": r.offset,
        "limit": r.limit,
        "context": r.context,
        "source_attribute": corpora::source_attribute(&r.query.corpus),
    });
    if sort.is_some() {
        payload["sort"] = json!(r.sort); // omitted when unsorted, so cache keys stay stable
    }
    Ok(payload)
}

/// Phrase counts are assigned from at most this many matches.
pub const PHRASE_CAP: u64 = 200_000;

/// `group_position` values: first | last | before | after (any search),
/// `word:N` (word N of a sequence, via CQP's target marker) and `phrase`
/// (the whole matched span, counted by the worker from `tabulate`).
pub fn frequency_payload(r: &FrequencyRequest) -> AppResult<Value> {
    let group_field = corpora::resolve_field(&r.query.corpus, &r.group_field)?;
    if !GROUPABLE.contains(&group_field.as_str()) {
        return invalid("Grouping by this field is not yet supported");
    }
    let pos = r.group_position.as_str();
    let (compiled, anchor) = if let Some(n) = pos.strip_prefix("word:") {
        let n: usize = n.parse().map_err(|_| crate::error::AppError::Validation("Choose which word to count".into()))?;
        let c = build_query_marked(&r.query, Some(n))?;
        // Word 1 and the last word have fixed anchors; anything between uses @.
        let words = followers(&r.query).len() + 1;
        let anchor = if n == 1 { "match" } else if n == words { "matchend" } else { "target" };
        (if anchor == "target" { c } else { build_query(&r.query)? }, anchor)
    } else if pos == "phrase" {
        (build_query(&r.query)?, "phrase")
    } else {
        (build_query(&r.query)?, group_anchor(pos)?)
    };
    let mut payload = json!({
        "op": "frequencies",
        "corpus": compiled.corpus,
        "expression": compiled.expression,
        "group_field": group_field,
        "group_anchor": anchor,
    });
    if anchor == "phrase" {
        payload["cap"] = json!(PHRASE_CAP);
        payload["fold_case"] = json!(r.query.ignore_case && CASE_FOLDABLE.contains(&group_field.as_str()));
    }
    Ok(payload)
}

pub fn collocate_payload(r: &CollocateRequest) -> AppResult<Value> {
    let compiled = build_query(&r.query)?;
    if !(1..=500).contains(&r.sample_limit) {
        return invalid("Collocation sample must contain 1–500 matches");
    }
    Ok(json!({
        "op": "collocates",
        "corpus": compiled.corpus,
        "expression": compiled.expression,
        "sample_limit": r.sample_limit,
    }))
}

pub fn compare_payload(r: &CompareRequest) -> AppResult<Value> {
    let mut seen = std::collections::HashSet::new();
    if !(2..=MAX_COMPARE).contains(&r.corpora.len()) || !r.corpora.iter().all(|c| seen.insert(c)) {
        return invalid(format!("Select 2–{MAX_COMPARE} different corpora"));
    }
    let base = match &r.query {
        Some(q) => QuerySpec { meta_attr: String::new(), meta_value: String::new(), ..q.clone() },
        None => {
            if !["word", "lexeme", "pos"].contains(&r.field.as_str()) {
                return invalid("Compare supports words, lexemes and exact POS tags");
            }
            QuerySpec { field: r.field.clone(), value: r.value.clone(), ignore_case: r.ignore_case, ..Default::default() }
        }
    };
    let mut compiled = Vec::new();
    for corpus in &r.corpora {
        let mut q = base.clone();
        q.corpus = corpus.clone();
        q.filters = r.filters.get(corpus).cloned().unwrap_or_default();
        // Sentence limits only where the corpus has sentences.
        if q.sentence_only && !corpora::get(corpus)?.structural.contains_key("s") {
            q.sentence_only = false;
        }
        let c = build_query(&q).map_err(|e| crate::error::AppError::Validation(format!("{corpus}: {e}")))?;
        let spec = filter_spec(&q);
        if spec.is_empty() {
            compiled.push(json!([c.corpus, c.expression, corpora::get(corpus)?.tokens]));
        } else {
            compiled.push(json!([c.corpus, c.expression, corpora::get(corpus)?.tokens, spec]));
        }
    }
    Ok(json!({
        "op": "compare",
        "corpora": r.corpora,
        "field": base.field,
        "value": base.value,
        "ignore_case": base.ignore_case,
        "compiled": compiled,
    }))
}

pub fn lexicon_payload(r: &LexiconRequest) -> AppResult<Value> {
    let field = corpora::resolve_field(&r.corpus, &r.field)?;
    if !["pos", "class", "rel", "usas"].contains(&field.as_str()) {
        return invalid("Lexicon browser supports POS, class and relation attributes");
    }
    Ok(json!({ "op": "lexicon", "corpus": r.corpus, "field": field }))
}

pub fn metadata_payload(r: &MetadataRequest) -> AppResult<Value> {
    let info = match corpora::all().get(&r.corpus) {
        Some(i) if i.metadata.iter().any(|m| m == &r.attribute) => i,
        _ => return invalid("Unknown metadata attribute"),
    };
    if info.structural.get(&r.attribute).copied().unwrap_or(0) > 10_000 {
        return invalid(
            "That attribute covers over 10,000 regions. Enter a filter value manually to avoid \
             loading a very large metadata index on the shared server.",
        );
    }
    Ok(json!({ "op": "metadata", "corpus": r.corpus, "attribute": r.attribute }))
}

/// Hits per value of a structural attribute (genre, decade, speaker sex…),
/// with that value's own token count so rates are comparable.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DistributionRequest {
    #[serde(flatten)]
    pub query: QuerySpec,
    pub attribute: String,
}

pub const DISTRIBUTION_CAP: u64 = 200_000;

pub fn distribution_payload(r: &DistributionRequest) -> AppResult<Value> {
    let compiled = build_query(&r.query)?;
    metadata_payload(&MetadataRequest { corpus: r.query.corpus.clone(), attribute: r.attribute.clone() })?;
    let mut payload = json!({
        "op": "distribution",
        "corpus": compiled.corpus,
        "expression": compiled.expression,
        "attribute": r.attribute,
        "cap": DISTRIBUTION_CAP,
    });
    let spec = filter_spec(&r.query);
    if !spec.is_empty() {
        payload["filters"] = json!(spec); // omitted when unfiltered, so cache keys stay stable
    }
    Ok(payload)
}

pub fn syntax_payload(r: &SyntaxRequest) -> AppResult<Value> {
    let tokens = corpora::get("EFCAM")?.tokens as i64;
    if r.corpus != "EFCAM" || !(0..tokens).contains(&r.position) {
        return invalid("Syntax trees currently require a valid EFCAM token position");
    }
    Ok(json!({ "op": "syntax", "corpus": "EFCAM", "position": r.position }))
}

pub fn health_payload() -> Value {
    json!({ "op": "health" })
}

// ---------------------------------------------------------------------------
// Small formatting helpers shared with the explanation texts
// ---------------------------------------------------------------------------

/// Python `repr()` of a validated string (no quotes/backslashes possible).
pub fn py_repr(s: &str) -> String {
    if s.contains('\'') && !s.contains('"') {
        format!("\"{s}\"")
    } else {
        format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

/// Python `str.title()`: upper-case the first letter of every alphabetic run.
pub fn py_title(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_alpha = false;
    for ch in s.chars() {
        if ch.is_alphabetic() {
            if prev_alpha { out.extend(ch.to_lowercase()) } else { out.extend(ch.to_uppercase()) }
            prev_alpha = true;
        } else {
            out.push(ch);
            prev_alpha = false;
        }
    }
    out
}

/// Python `f"{n:,}"`.
pub fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// Python `f"{x:,.2f}"` for non-negative values.
pub fn thousands_2dp(x: f64) -> String {
    let s = format!("{x:.2}");
    let (int, frac) = s.split_once('.').unwrap_or((&s, "00"));
    format!("{}.{}", thousands(int.parse().unwrap_or(0)), frac)
}

#[cfg(test)]
mod filter_and_position_tests {
    use super::*;

    fn bnc(value: &str) -> QuerySpec {
        QuerySpec { corpus: "BNC".into(), field: "word".into(), value: value.into(), ignore_case: true, ..Default::default() }
    }

    #[test]
    fn several_filters_are_anded() {
        let mut q = bnc("you");
        q.filters = vec![
            MetaFilter { attr: "text_text_type".into(), op: "is".into(), value: "SPOKEN DEMOGRAPHIC|SPOKEN CONTEXT".into(), ..Default::default() },
            MetaFilter { attr: "text_respondent_age".into(), op: "not".into(), value: "unknown".into(), ..Default::default() },
            MetaFilter { attr: "text_publication_date".into(), op: "years".into(), from: Some(1990), to: Some(1992), ..Default::default() },
        ];
        let e = build_query(&q).unwrap().expression;
        assert_eq!(
            e,
            r#"[word="you" %c] :: match.text_text_type="(SPOKEN DEMOGRAPHIC|SPOKEN CONTEXT)" & match.text_respondent_age!="unknown" & match.text_publication_date="(1990|1991|1992).*""#
        );
    }

    #[test]
    fn filter_validation() {
        let mut q = bnc("you");
        q.filters = vec![MetaFilter { attr: "nope".into(), op: "is".into(), value: "x".into(), ..Default::default() }];
        assert!(build_query(&q).is_err());
        q.filters = vec![MetaFilter { attr: "text_text_type".into(), op: "is".into(), value: "a\"; drop".into(), ..Default::default() }];
        assert!(build_query(&q).is_err());
        q.filters = vec![MetaFilter { attr: "text_text_type".into(), op: "years".into(), from: Some(2000), to: Some(1990), ..Default::default() }];
        assert!(build_query(&q).is_err());
        q.filters = vec![MetaFilter { attr: "text_text_type".into(), op: "is".into(), value: "W.ac".into(), ..Default::default() }];
        assert!(build_query(&q).unwrap().expression.ends_with(r#"match.text_text_type="W\.ac""#));
    }

    #[test]
    fn legacy_single_filter_unchanged() {
        let mut q = bnc("go");
        q.meta_attr = "text_text_type".into();
        q.meta_value = "SPOKEN".into();
        assert_eq!(build_query(&q).unwrap().expression, r#"[word="go" %c] :: match.text_text_type="SPOKEN""#);
    }

    #[test]
    fn count_any_word_of_a_sequence() {
        let mut q = bnc("you");
        q.next = vec![
            NextToken { value: "and".into(), ..Default::default() },
            NextToken { value: "not".into(), optional: true, ..Default::default() },
            NextToken { value: "I|me".into(), gap: 1, ..Default::default() },
        ];
        let req = |pos: &str| FrequencyRequest { query: q.clone(), group_field: "word".into(), group_position: pos.into() };
        let p = frequency_payload(&req("word:3")).unwrap();
        assert_eq!(p["group_anchor"], "target");
        assert!(p["expression"].as_str().unwrap().contains(r#" @[word="not" %c]?"#));
        assert_eq!(frequency_payload(&req("word:1")).unwrap()["group_anchor"], "match");
        assert_eq!(frequency_payload(&req("word:4")).unwrap()["group_anchor"], "matchend");
        assert!(!frequency_payload(&req("word:4")).unwrap()["expression"].as_str().unwrap().contains('@'));
        assert!(frequency_payload(&req("word:9")).is_err());
        let ph = frequency_payload(&req("phrase")).unwrap();
        assert_eq!((ph["group_anchor"].as_str(), ph["fold_case"].as_bool()), (Some("phrase"), Some(true)));
    }
}

#[cfg(test)]
mod sequence_tests {
    use super::*;

    fn q(corpus: &str) -> QuerySpec {
        QuerySpec { corpus: corpus.into(), field: "word".into(), value: "you".into(), ignore_case: true, ..Default::default() }
    }

    #[test]
    fn three_words_with_alternatives() {
        let mut s = q("BNC-BABY");
        s.next = vec![
            NextToken { value: "and".into(), ..Default::default() },
            NextToken { value: "I | me".into(), ..Default::default() },
        ];
        assert_eq!(build_query(&s).unwrap().expression, r#"[word="you" %c] [word="and" %c] [word="(I|me)" %c]"#);
    }

    #[test]
    fn legacy_second_then_next_with_gap_and_optional() {
        let mut s = q("BNC-BABY");
        s.second_value = "and".into();
        s.next = vec![
            NextToken { value: "not".into(), optional: true, ..Default::default() },
            NextToken { value: "me".into(), gap: 2, ..Default::default() },
        ];
        assert_eq!(build_query(&s).unwrap().expression, r#"[word="you" %c] [word="and" %c] [word="not" %c]? []{0,2} [word="me" %c]"#);
    }

    #[test]
    fn rejects_bad_sequences() {
        let mut s = q("BNC-BABY");
        s.next = vec![NextToken { value: "me".into(), optional: true, ..Default::default() }];
        assert!(build_query(&s).is_err());
        s.next = vec![NextToken { value: "I||me".into(), ..Default::default() }];
        assert!(build_query(&s).is_err());
        s.next = vec![NextToken { value: "a.b".into(), ..Default::default() }];
        assert!(build_query(&s).unwrap().expression.ends_with(r#"[word="a\.b" %c]"#));
        s.next = (0..9).map(|_| NextToken { value: "x".into(), ..Default::default() }).collect();
        assert!(build_query(&s).is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(corpus: &str, field: &str, value: &str) -> QuerySpec {
        QuerySpec { corpus: corpus.into(), field: field.into(), value: value.into(), ..Default::default() }
    }

    #[test]
    fn valid_compound_query() {
        let spec = QuerySpec {
            field: "pos".into(),
            second_field: "pos".into(),
            second_value: "NN".into(),
            gap: 3,
            sentence_only: true,
            meta_attr: "file_id".into(),
            meta_value: "A01".into(),
            ..q("BROWN-LEGACY", "pos", "JJ")
        };
        let c = build_query(&spec).unwrap();
        assert_eq!(c.expression, r#"[pos="JJ"] []{0,3} [pos="NN"] within s :: match.file_id="A01""#);
        let p = search_payload(&SearchRequest { query: spec, offset: 0, limit: 10, context: 4, sort: String::new() }, false).unwrap();
        assert_eq!(p["source_attribute"], "file_id");
        assert_eq!(p["expression"], c.expression);
    }

    #[test]
    fn literal_vs_regex() {
        assert_eq!(build_query(&q("BROWN-LEGACY", "word", "a.b")).unwrap().expression, r#"[word="a\.b"]"#);
        let mut r = q("BROWN-LEGACY", "word", "a.b");
        r.regex = true;
        assert_eq!(build_query(&r).unwrap().expression, r#"[word="a.b"]"#);
    }

    #[test]
    fn rejects_command_injection() {
        for v in ["jury\";save GUIQuery;", "jury\nexit;", "jury\\abc", "\u{0}"] {
            assert!(build_query(&q("BROWN-LEGACY", "word", v)).is_err(), "{v:?}");
        }
        let mut bad = q("BROWN-LEGACY", "word", "jury");
        bad.meta_attr = "broken".into();
        bad.meta_value = "A01".into();
        assert!(build_query(&bad).is_err());
        let mut gap = q("BROWN-LEGACY", "word", "jury");
        gap.gap = 20;
        gap.second_value = "said".into();
        assert!(build_query(&gap).is_err());
    }

    #[test]
    fn case_folding_rules() {
        let mut r = q("BROWN-LEGACY", "word", "jury");
        r.ignore_case = true;
        assert_eq!(build_query(&r).unwrap().expression, r#"[word="jury" %c]"#);
        let mut p = q("BROWN-LEGACY", "pos", "NN");
        p.ignore_case = true;
        assert!(build_query(&p).is_err());
    }

    #[test]
    fn anchors_allow_listed() {
        for (k, v) in GROUP_ANCHORS {
            assert_eq!(group_anchor(k).unwrap(), v);
            let r = FrequencyRequest {
                query: q("BNC-BABY", "lexeme", "deliver"),
                group_field: "word".into(),
                group_position: k.into(),
            };
            assert_eq!(frequency_payload(&r).unwrap()["group_anchor"], v);
        }
        for bad in ["matchend;exit", "", "../../etc"] {
            assert!(group_anchor(bad).is_err());
        }
    }

    #[test]
    fn comparison_checks() {
        let r = CompareRequest {
            corpora: vec!["BROWN-LEGACY".into(), "BNC-BABY".into()],
            field: "word".into(),
            value: "jury".into(),
            ignore_case: true,
            query: None,
            filters: Default::default(),
        };
        let p = compare_payload(&r).unwrap();
        assert_eq!(p["compiled"].as_array().unwrap().len(), 2);
        assert_eq!(p["compiled"][0][0], "BROWN-LEGACY");
        assert_eq!(p["compiled"][0][2], 1137466);
        let mut same = r.clone();
        same.corpora = vec!["BROWN-LEGACY".into(), "BROWN-LEGACY".into()];
        assert!(compare_payload(&same).is_err());
        let mut bogus = r.clone();
        bogus.corpora = vec!["BROWN-LEGACY".into(), "BOGUS".into()];
        assert!(compare_payload(&bogus).is_err());
        let mut lex = r.clone();
        lex.field = "lexeme".into();
        assert!(compare_payload(&lex).is_err());
    }

    #[test]
    fn metadata_and_syntax_bounds() {
        assert!(metadata_payload(&MetadataRequest { corpus: "CLMET".into(), attribute: "text_genre".into() }).is_ok());
        assert!(metadata_payload(&MetadataRequest { corpus: "BNC".into(), attribute: "u_sex".into() }).is_err());
        assert!(syntax_payload(&SyntaxRequest { corpus: "EFCAM".into(), position: 5 }).is_ok());
        assert!(syntax_payload(&SyntaxRequest { corpus: "EFCAM".into(), position: 36_353_681 }).is_err());
        assert!(syntax_payload(&SyntaxRequest { corpus: "BNC".into(), position: 5 }).is_err());
    }

    #[test]
    fn number_formatting() {
        assert_eq!(thousands(1234567), "1,234,567");
        assert_eq!(thousands(12), "12");
        assert_eq!(thousands_2dp(5000.0), "5,000.00");
        assert_eq!(py_repr("jury"), "'jury'");
        assert_eq!(py_repr("don't"), "\"don't\"");
    }
}

#[cfg(test)]
mod feature_tests {
    use super::*;

    #[test]
    fn sort_is_allow_listed_and_omitted_when_unsorted() {
        let q = QuerySpec { corpus: "BNC-BABY".into(), value: "jury".into(), ..Default::default() };
        let mut r = SearchRequest { query: q, offset: 0, limit: 25, context: 4, sort: String::new() };
        assert!(search_payload(&r, false).unwrap().get("sort").is_none());
        r.sort = "right".into();
        assert_eq!(search_payload(&r, false).unwrap()["sort"], "right");
        r.sort = "match; exit".into();
        assert!(search_payload(&r, false).is_err());
    }

    #[test]
    fn compare_full_query_in_many_corpora() {
        let q = QuerySpec { field: "word".into(), value: "you".into(), ignore_case: true, sentence_only: true,
            next: vec![NextToken { value: "and".into(), ..Default::default() }, NextToken { value: "I|me".into(), ..Default::default() }],
            meta_attr: "text_genre".into(), meta_value: "x".into(), ..Default::default() };
        let r = CompareRequest { corpora: vec!["BROWN-LEGACY".into(), "LOB-LEGACY".into(), "FLOB-LEGACY".into()], field: String::new(), value: String::new(), ignore_case: false, query: Some(q), filters: Default::default() };
        let p = compare_payload(&r).unwrap();
        let c = p["compiled"].as_array().unwrap();
        assert_eq!(c.len(), 3);
        assert!(c[0][1].as_str().unwrap().contains(r#"[word="(I|me)" %c]"#));
        assert!(!c[0][1].as_str().unwrap().contains("::"));
        // Per-corpus filters travel with the corpus and add a subcorpus spec.
        let mut f = r.clone();
        f.filters.insert("LOB-LEGACY".into(), vec![MetaFilter { attr: "file_id".into(), op: "is".into(), value: "A01|A02".into(), ..Default::default() }]);
        let p = compare_payload(&f).unwrap();
        let c = p["compiled"].as_array().unwrap();
        assert_eq!(c[0].as_array().unwrap().len(), 3);
        assert!(c[1][1].as_str().unwrap().ends_with(r#":: match.file_id="(A01|A02)""#));
        assert_eq!(c[1][3][0]["values"], json!(["A01", "A02"]));
        let dup = CompareRequest { corpora: vec!["BNC".into(), "BNC".into()], ..r };
        assert!(compare_payload(&dup).is_err());
    }
}
