//! Corpus-aware annotation codebook and guided "Learn & build" recipes
//! (port of linguistics_guide.py and the logic half of learning_ui.py).
//!
//! The tag dictionaries live in `resources/codebook.json`, generated
//! mechanically from the Python dictionaries so no gloss was retyped by hand.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

use crate::corpora;
use crate::error::{invalid, AppResult};
use crate::query::{build_query, QuerySpec};
use crate::workflow::compile_workflow;

#[derive(Debug, Deserialize)]
struct Codebook {
    sources: BTreeMap<String, String>,
    tagsets: BTreeMap<String, BTreeMap<String, String>>,
    class: BTreeMap<String, String>,
    rel: BTreeMap<String, String>,
    usas: BTreeMap<String, String>,
    usas_families: BTreeMap<String, String>,
    /// Ordered: [field, label, note]
    fields: Vec<(String, String, String)>,
    concepts: Vec<(String, String)>,
    patterns: BTreeMap<String, BTreeMap<String, String>>,
    guided_modes: Vec<String>,
    parts: Vec<String>,
}

fn book() -> &'static Codebook {
    static B: OnceLock<Codebook> = OnceLock::new();
    B.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/codebook.json"))
            .expect("bundled codebook.json is valid (checked by unit test)")
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Explanation {
    pub short: String,
    pub full: String,
    pub note: String,
    pub reference: String,
    pub verified: bool,
}

fn ex(short: impl Into<String>, full: impl Into<String>, note: impl Into<String>, reference: &str, verified: bool) -> Explanation {
    Explanation { short: short.into(), full: full.into(), note: note.into(), reference: reference.into(), verified }
}

fn src(key: &str) -> &'static str {
    book().sources.get(key).map(String::as_str).unwrap_or("")
}

pub fn tagset(corpus: &str) -> &'static str {
    match corpus {
        "BNC" | "BNC-BABY" | "DOORCORP" => "C5",
        "BNC2014-S" => "C7",
        "BROWN-LEGACY" | "FLOB-LEGACY" | "FROWN-LEGACY" | "LOB-LEGACY" => "BROWN",
        _ => "PENN",
    }
}

fn tag_source(scheme: &str) -> &'static str {
    match scheme {
        "C5" => src("C5"),
        "C7" => src("C7"),
        _ => src("PENN"),
    }
}

pub fn field_explanation(corpus: &str, field: &str) -> Explanation {
    if let Some((_, label, note)) = book().fields.iter().find(|(f, _, _)| f == field) {
        let mut note = note.clone();
        if field == "lexeme" && tagset(corpus) == "BROWN" {
            note.push_str(" This corpus has no lexeme index; use a word/POS search instead.");
        }
        return ex(label.clone(), label.clone(), note, "", true);
    }
    if let Some(rest) = field.strip_prefix("text_") {
        let guess = format!("Document metadata: {}", rest.replace('_', " "));
        return ex(guess.clone(), guess, "This is a field name inferred from its spelling; inspect actual stored values before interpreting.", "", true);
    }
    if let Some(rest) = field.strip_prefix("u_") {
        let guess = format!("Utterance/speaker attribute: {}", rest.replace('_', " "));
        return ex(guess.clone(), guess, "Exact meaning depends on corpus documentation. Do not infer sensitive demographic information from the field name alone.", "", false);
    }
    ex("Corpus-specific indexed field", "Corpus-specific indexed field",
       "No verified definition is packaged for this field. Inspect the values and consult corpus documentation.", "", false)
}

pub fn explain(corpus: &str, field: &str, value: &str) -> Explanation {
    let b = book();
    let field = if field == "lexeme" {
        if corpus == "BNC" || corpus == "BNC-BABY" { "hw" } else { "lemma" }
    } else {
        field
    };
    if value == "__UNDEF__" {
        return ex("Undefined / not annotated", "Undefined or unavailable annotation",
            "The corpus does not specify this value for this token. It does not necessarily mean a linguistic error.", "", true);
    }
    if field == "pos" {
        let scheme = tagset(corpus);
        let mapping = &b.tagsets[scheme];
        let reference = tag_source(scheme);
        if let Some(full) = mapping.get(value) {
            return ex(full.clone(), full.clone(),
                "This is an automated classification, not a guarantee of grammatical correctness. It can differ from annotations in another corpus.",
                reference, true);
        }
        if scheme == "C5" && value.contains('-') {
            let parts: Vec<&str> = value.split('-').collect();
            if parts.len() == 2 && parts.iter().all(|p| mapping.contains_key(*p)) {
                let (a, bb) = (parts[0], parts[1]);
                let (ma, mb) = (&mapping[a], &mapping[bb]);
                return ex(
                    format!("{ma} / {mb} (uncertain)"),
                    format!("Ambiguous: {ma} OR {mb}"),
                    format!("C5 leaves this unresolved. The first tag ({a}) is the preferred reading; {bb} is an alternative. Do not count it as an unambiguous {}.", ma.to_lowercase()),
                    reference, true);
            }
        }
        if scheme == "BROWN" {
            if let Some(tail) = value.strip_prefix("FW-") {
                let base = (tail != "FW-").then(|| explain(corpus, "pos", tail));
                let suffix = match &base { Some(e) if e.verified => format!(" / {}", e.short), _ => String::new() };
                return ex(format!("Foreign word{suffix}"), "Foreign word with grammatical annotation",
                    "Brown FW- marks foreign-origin material; the rest is the grammatical tag.", reference, true);
            }
            if let Some(head) = value.strip_suffix("-NC") {
                let base = explain(corpus, "pos", head);
                return ex(format!("{} (cited form)", base.short), format!("{} — metalinguistically cited", base.full),
                    "Brown -NC is used in cited/metalinguistic uses; confirm the context.", reference, true);
            }
            if value.contains('+') {
                let mapped: Vec<String> = value.split('+').map(|p| mapping.get(p).cloned().unwrap_or_else(|| p.to_string())).collect();
                let joined = mapped.join(" + ");
                return ex(joined.clone(), format!("Contracted/combined Brown tags: {joined}"),
                    "The token contains a combined annotation, often for contractions; do not interpret it as a two-token sequence.", reference, true);
            }
            if let Some(head) = value.strip_suffix('*') {
                let base = explain(corpus, "pos", head);
                return ex(format!("{} (negated)", base.short), format!("{} with negative contraction", base.full),
                    "Brown asterisk often marks contracted negation (e.g. isn’t).", reference, true);
            }
        }
        return ex(format!("Unknown POS tag: {value}"), format!("Not in the available {scheme} glossary"),
            "Preserved exactly as stored. Do not infer a grammatical category without a verified codebook.", reference, false);
    }
    if field == "class" {
        if let Some(c) = b.class.get(value) {
            return ex(c.clone(), c.clone(), "This is a broad corpus class, and may include items outside an intuitive narrow part of speech.", src("C5"), true);
        }
    }
    if field == "usas" {
        if let Some(u) = b.usas.get(value) {
            return ex(u.clone(), u.clone(), "USAS is a semantic domain classification, NOT a grammatical POS tag.", src("USAS"), true);
        }
        if let Some(fam) = value.chars().next().and_then(|c| b.usas_families.get(&c.to_string())) {
            return ex(format!("Semantic family: {fam}"), format!("USAS semantic family: {fam}"),
                "Only the broad initial letter is decoded. The specific subtype is not verified; consult the USAS reference.", src("USAS"), false);
        }
        return ex("Unverified semantic category", format!("No local USAS definition for {value}"),
            "Consult the official USAS codebook. Do not guess a semantic category.", src("USAS"), false);
    }
    if field == "rel" {
        if let Some(r) = b.rel.get(value) {
            return ex(r.clone(), r.clone(), "A Stanford-style dependency edge from this token to its governing head token.", "", true);
        }
        if value.starts_with("prep_") || value.starts_with("prepc_") {
            let tail = value.split_once('_').map(|x| x.1).unwrap_or(value);
            return ex(format!("Collapsed prepositional relation: {tail}"), "Collapsed dependency via a preposition",
                "The preposition is encoded in the relation name. Do not invent a missing explicit preposition edge.", "", true);
        }
        if let Some(tail) = value.strip_prefix("conj_") {
            return ex(format!("Coordinated dependent: {tail}"), "Coordination relation",
                "The conjunction is encoded in the relation label.", "", true);
        }
    }
    if field == "lemma" && (corpus == "BNC" || corpus == "BNC-BABY") {
        if let Some((lemma, cl)) = value.rsplit_once('_') {
            if let Some(c) = b.class.get(cl) {
                return ex(format!("{lemma} · {c}"), format!("Headword {lemma}, class {cl}"),
                    "BNC lemma values combine the headword and grammatical class; choose lexeme for all uses of the headword.", "", true);
            }
        }
    }
    if field == "text_genre" {
        if let Some(rest) = value.strip_prefix("W:ac:") {
            return ex(format!("Written academic: {rest}"), format!("Written academic text: {rest}"),
                "BNC-style corpus genre code. This explanation is based on the code structure; inspect the corpus guide for taxonomy.", "", false);
        }
    }
    if ["word", "lemma", "hw"].contains(&field) {
        return ex("Written/lexical value (not a grammatical code)", value,
            "A word or headword is text, not a grammatical label. Use POS or class for linguistic categorization.", "", true);
    }
    ex(value, value, field_explanation(corpus, field).note, "", false)
}

#[derive(Debug, Clone, Serialize)]
pub struct GlossaryRow {
    pub category: String,
    pub code: String,
    pub label: String,
    pub note: String,
}

pub fn glossary_rows(corpus: &str) -> Vec<GlossaryRow> {
    let b = book();
    let scheme = tagset(corpus);
    let mut rows = Vec::new();
    let mut push = |cat: &str, code: &str, label: String, note: String| {
        rows.push(GlossaryRow { category: cat.into(), code: code.into(), label, note })
    };
    for code in b.tagsets[scheme].keys() {
        let e = explain(corpus, "pos", code);
        push("POS", code, e.short, e.note);
    }
    if scheme == "C5" {
        for tag in ["VVG-AJ0", "AJ0-VVG", "NN1-VVB", "AJ0-NN1", "AV0-AJ0"] {
            let e = explain(corpus, "pos", tag);
            push("POS", tag, e.short, e.note);
        }
    }
    if ["BNC", "BNC-BABY", "BNC2014-S", "CLMET", "EFCAM"].contains(&corpus) {
        for code in b.class.keys() {
            let e = explain(corpus, "class", code);
            push("Class", code, e.short, e.note);
        }
    }
    if corpora::get(corpus).is_ok_and(|c| c.positional.iter().any(|p| p == "usas")) {
        for code in b.usas.keys() {
            let e = explain(corpus, "usas", code);
            push("USAS", code, e.short, e.note);
        }
    }
    if corpus == "EFCAM" {
        for code in b.rel.keys() {
            let e = explain(corpus, "rel", code);
            push("Dependency", code, e.short, e.note);
        }
    }
    for (field, label, note) in &b.fields {
        push("Field", field, label.clone(), note.clone());
    }
    for (concept, note) in &b.concepts {
        push("Concept", concept, concept.clone(), note.clone());
    }
    rows
}

pub fn pattern_tag(corpus: &str, label: &str) -> Option<String> {
    book().patterns.get(tagset(corpus))?.get(label).cloned()
}

pub fn guided_modes() -> &'static [String] {
    &book().guided_modes
}
pub fn parts_of_speech() -> &'static [String] {
    &book().parts
}

// ---------------------------------------------------------------------------
// Guided recipes ("Learn & build")
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct RecipeInput {
    pub corpus: String,
    /// Index into `guided_modes()` (0–8).
    pub mode: usize,
    pub word: String,
    pub alt: String,
    pub first: String,
    pub second: String,
    pub gap: i64,
    pub genre: String,
    pub pos: String,
}
impl Default for RecipeInput {
    fn default() -> Self {
        Self { corpus: "BROWN-LEGACY".into(), mode: 0, word: "go".into(), alt: "walk".into(),
               first: "adjective".into(), second: "noun".into(), gap: 0,
               genre: "Narrative fiction".into(), pos: "noun".into() }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Recipe {
    /// Single-search query (load into the Search form) …
    pub base: QuerySpec,
    /// … or a multi-step workflow (load into the workflow builder).
    pub steps: Option<Vec<Value>>,
    pub note: String,
    pub preview: String,
    pub question: String,
}

pub fn build_recipe(input: &RecipeInput) -> AppResult<Recipe> {
    let corpus = input.corpus.as_str();
    let info = match corpora::all().get(corpus) { Some(i) => i, None => return invalid("Choose a known corpus.") };
    let Some(question) = guided_modes().get(input.mode).cloned() else { return invalid("Unknown guided question") };
    let word = input.word.trim().to_string();
    let alt = input.alt.trim().to_string();
    let mut base = QuerySpec { corpus: corpus.into(), field: "word".into(), value: word.clone(), ignore_case: true, ..Default::default() };
    let mut note = "Searches word forms exactly as written (with case ignored).".to_string();
    let mut steps: Option<Vec<Value>> = None;
    let has_s = info.structural.contains_key("s");

    match input.mode {
        0 => {}
        1 => {
            base.field = "lexeme".into();
            note = "Finds related inflected forms through this corpus’s headword/lemma index; check the actual lexical categories.".into();
        }
        2..=4 => {
            let (a, b) = (input.first.as_str(), input.second.as_str());
            let (Some(first), Some(second)) = (pattern_tag(corpus, a), pattern_tag(corpus, b)) else {
                return invalid("This corpus lacks the selected basic POS preset.");
            };
            let cap = crate::query::py_title;
            if input.mode == 2 {
                base = QuerySpec { corpus: corpus.into(), field: "pos".into(), value: first.clone(),
                                   second_field: "pos".into(), second_value: second.clone(), ..Default::default() };
                let example = match (a, b) {
                    ("adjective", "noun") => Some("large house"),
                    ("adverb", "adjective") => Some("very good"),
                    ("adverb", "verb-ing") => Some("quickly walking"),
                    ("noun", "verb-ing") => Some("children playing"),
                    ("adverb", "past verb") => Some("quickly walked"),
                    _ => None,
                };
                note = format!("{} [{first}] followed by {b} [{second}].", cap(a));
                match example {
                    Some(e) => note.push_str(&format!(" Example of this ORDER: “{e}”.")),
                    None => note.push_str(" This is a token-level pattern; examine concordances to interpret its grammar."),
                }
            } else if input.mode == 3 {
                base = QuerySpec { corpus: corpus.into(), field: "word".into(), value: word.clone(),
                                   second_field: "pos".into(), second_value: second.clone(), ignore_case: true, ..Default::default() };
                note = format!("Exact written word “{word}” followed by a {b} [{second}].");
            } else {
                base = QuerySpec { corpus: corpus.into(), field: "pos".into(), value: first.clone(),
                                   second_field: "word".into(), second_value: word.clone(), ..Default::default() };
                note = format!("A {a} [{first}] followed by written word “{word}”. The second word is case-sensitive in this preset; edit in Search to adjust.");
            }
            base.gap = input.gap;
            if has_s { base.sentence_only = true; }
            note.push_str(" The maximum gap is the number of intervening indexed tokens; 0 means adjacent. This is linear order, not a syntactic dependency.");
        }
        5 => {
            steps = Some(vec![
                json!({"kind":"search","query":{"field":"word","value":word,"ignore_case":true}}),
                json!({"kind":"search","query":{"field":"word","value":alt,"ignore_case":true}}),
                json!({"kind":"combine","left":1,"right":2,"method":"union"}),
            ]);
            note = "UNION combines exact match spans from two searches. It does not join whole documents and does not calculate significance.".into();
        }
        6 => {
            let Some(tag) = pattern_tag(corpus, &input.pos) else { return invalid("No verified tag preset for this corpus.") };
            let field = if info.lexeme.is_some() { "lexeme" } else { "word" };
            steps = Some(vec![
                json!({"kind":"search","query":{"field":field,"value":word,"ignore_case":true}}),
                json!({"kind":"refine","source":1,"mode":"keep","field":"pos","value":tag,"anchor":"match","ignore_case":false}),
            ]);
            note = format!("Search {field} “{word}”, then keep tokens with POS {tag} ({}). The exact tag may omit uncertain or comparative forms.", input.pos);
        }
        7 => {
            if !info.metadata.iter().any(|m| m == "text_genre") {
                return invalid(format!("{corpus} has no indexed text_genre; try CLMET or BNC."));
            }
            base.meta_attr = "text_genre".into();
            base.meta_value = input.genre.trim().into();
            note = "Restricts written-word matches to documents with the exact stored genre value. Use Corpora > Contents & metadata to list values rather than guessing them.".into();
        }
        8 => {
            let adv = pattern_tag(corpus, "adverb").unwrap_or_default();
            let verb = pattern_tag(corpus, "verb-ing").unwrap_or_default();
            steps = Some(vec![
                json!({"kind":"search","query":{"field":"pos","value":adv,"second_field":"pos","second_value":verb,"gap":input.gap,"sentence_only":has_s}}),
                json!({"kind":"search","query":{"field":"pos","value":verb,"second_field":"pos","second_value":adv,"gap":input.gap,"sentence_only":has_s}}),
                json!({"kind":"combine","left":1,"right":2,"method":"union"}),
            ]);
            note = "Step 1 finds adverb BEFORE an -ing verb. Step 2 finds -ing verb BEFORE an adverb. The results report counts for both steps, then their union. These are word-order candidates, not verified adverb-verb syntactic relationships. Inspect the sentences before drawing conclusions.".into();
        }
        _ => return invalid("Unknown guided question"),
    }

    let preview = if let Some(s) = &steps {
        let c = compile_workflow(&json!({"corpus": corpus, "steps": s}))?;
        format!("{}\n\nAdvanced CQP preview:\n{}", c.summaries.join("\n"), c.script)
    } else {
        let c = build_query(&base)?;
        format!("Matching index: {}.\n\nAdvanced CQP preview:\n{corpus};\nGUIQuery = {};", c.field, c.expression)
    };
    Ok(Recipe { base, steps, note, preview, question })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference outputs captured from the Python `explain()` implementation.
    #[test]
    fn explain_matches_python_reference() {
        let reference: Vec<(String, String, String, String, String, String, String, bool)> =
            serde_json::from_str(include_str!("../resources/test/explain_ref.json")).unwrap();
        for (corpus, field, value, short, full, note, refr, verified) in reference {
            let e = explain(&corpus, &field, &value);
            assert_eq!((e.short, e.full, e.note, e.reference, e.verified),
                       (short, full, note, refr, verified), "{corpus}/{field}/{value}");
        }
    }

    #[test]
    fn glossary_sizes_match_python() {
        assert_eq!(glossary_rows("BNC").len(), 109);
        assert_eq!(glossary_rows("EFCAM").len(), 106);
        assert_eq!(glossary_rows("BROWN-LEGACY").len(), 103);
    }

    #[test]
    fn recipes_compile() {
        for mode in 0..9 {
            let corpus = if mode == 7 { "CLMET" } else { "BNC-BABY" };
            let r = build_recipe(&RecipeInput { corpus: corpus.into(), mode, ..Default::default() });
            assert!(r.is_ok(), "mode {mode}: {:?}", r.err());
        }
    }
}
