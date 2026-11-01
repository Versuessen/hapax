//! Verified corpus inventory (`corpora.json`, unchanged from the Python app),
//! compiled into the binary so the app never depends on a loose data file.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{OnceLock, RwLock};

use crate::error::{invalid, AppResult};

pub const CWB_REGISTRY: &str = "/home/s/structeng/firth/registry";
pub const CQP_VERSION_NOTE: &str = "3.5.1";
pub const SEARCH_LIMIT: u32 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorpusInfo {
    pub description: String,
    pub tokens: u64,
    pub encoding: String,
    pub positional: Vec<String>,
    /// Structural attribute -> number of regions.
    pub structural: BTreeMap<String, u64>,
    /// Structural attributes that carry values usable as metadata filters.
    pub metadata: Vec<String>,
    /// Which positional attribute implements "lexeme" (hw / lemma), if any.
    pub lexeme: Option<String>,
    /// Present in the server registry at the last connect (true until checked).
    #[serde(default = "yes")]
    pub available: bool,
    /// "verified" (bundled, checked by hand) or "discovered" (read from the registry).
    #[serde(default = "verified")]
    pub source: String,
    /// Language variety as a BCP 47-style tag: `en-GB`, `en-US`, `en-AU`, …,
    /// `en-learner` for learner corpora, a bare language (`de`) when only that is
    /// known, or `None` when unknown.
    #[serde(default)]
    pub variety: Option<String>,
    /// Where `variety` comes from or what it covers, shown as a tooltip.
    #[serde(default)]
    pub variety_note: Option<String>,
}

/// Best guess at a discovered corpus's variety, from its registry `NAME`
/// and `##:: language` header. Conservative: returns `None` rather than guess.
pub fn infer_variety(name: &str, id: &str, language: &str) -> (Option<String>, Option<String>) {
    let text = format!(" {} {} ", name.to_lowercase(), id.to_lowercase());
    const PLACES: [(&str, &[&str]); 8] = [
        ("en-GB", &["british", " bnc", "britain", "england", " uk "]),
        ("en-US", &["american", " usa", " u.s.", "united states", " coca"]),
        ("en-AU", &["australia"]),
        ("en-NZ", &["new zealand"]),
        ("en-CA", &["canad"]),
        ("en-IE", &["irish", "ireland"]),
        ("en-IN", &["india"]),
        ("en-learner", &["learner", " esl", " efl", "interlanguage"]),
    ];
    let hits: Vec<&str> = PLACES.iter().filter(|(_, keys)| keys.iter().any(|k| text.contains(k))).map(|(v, _)| *v).collect();
    if hits.len() == 1 {
        return (Some(hits[0].to_string()), Some(format!("Inferred from the corpus name “{}”", name.trim())));
    }
    let lang = language.trim().to_lowercase();
    if !lang.is_empty() && lang != "??" && lang.chars().all(|c| c.is_ascii_alphabetic() || c == '-') && lang.len() <= 8 {
        return (Some(lang), Some("Language from the corpus registry; regional variety unknown".into()));
    }
    (None, None)
}

fn yes() -> bool { true }
fn verified() -> String { "verified".into() }

pub type Inventory = BTreeMap<String, CorpusInfo>;

/// Hand-verified metadata shipped with the app.
pub fn bundled() -> &'static Inventory {
    static BUNDLED: OnceLock<Inventory> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/corpora.json"))
            .expect("bundled corpora.json is valid (checked by unit test)")
    })
}

/// The live inventory. Starts as the bundled one; replaced after each connect
/// by `merge_registry` so corpora added to or removed from the server are
/// picked up without an app update. Old snapshots are leaked deliberately: a
/// few KB per connect, in exchange for `&'static` borrows everywhere.
static LIVE: RwLock<Option<&'static Inventory>> = RwLock::new(None);

pub fn all() -> &'static Inventory {
    if let Some(inv) = *LIVE.read().unwrap_or_else(|e| e.into_inner()) {
        return inv;
    }
    bundled()
}

pub fn replace(inv: Inventory) -> &'static Inventory {
    let leaked: &'static Inventory = Box::leak(Box::new(inv));
    *LIVE.write().unwrap_or_else(|e| e.into_inner()) = Some(leaked);
    leaked
}

pub fn get(name: &str) -> AppResult<&'static CorpusInfo> {
    match all().get(name) {
        Some(c) => Ok(c),
        None => invalid(format!("Unknown corpus: {name}")),
    }
}

/// Charsets CWB 3.5 accepts in a registry file.
const CWB_CHARSETS: [&str; 15] = [
    "ascii", "latin1", "latin2", "latin3", "latin4", "latin5", "latin6", "latin7", "latin8", "latin9",
    "cyrillic", "arabic", "greek", "hebrew", "utf8",
];

/// Result of comparing the server registry with what the app knew before.
#[derive(Debug, Clone, Serialize)]
pub struct Discovery {
    pub corpora: Inventory,
    /// On the server but not in the bundled inventory.
    pub added: Vec<String>,
    /// In the bundled inventory but not on the server.
    pub missing: Vec<String>,
    /// Bundled corpora whose registry charset changed validity (e.g. fixed by the admin).
    pub changed: Vec<String>,
}

/// Build the live inventory from the worker's `registry` reply.
/// Bundled metadata wins where it exists (it was verified by hand); the registry
/// decides which corpora exist and whether their charset is usable.
pub fn merge_registry(reply: &Value) -> Discovery {
    let mut inv = Inventory::new();
    let (mut added, mut missing, mut changed) = (Vec::new(), Vec::new(), Vec::new());
    let mut seen = std::collections::BTreeSet::new();

    for c in reply.get("corpora").and_then(Value::as_array).into_iter().flatten() {
        let Some(id) = c.get("id").and_then(Value::as_str).map(|s| s.to_uppercase()) else { continue };
        if !valid_corpus_id(&id) {
            continue;
        }
        seen.insert(id.clone());
        let charset = c.get("charset").and_then(Value::as_str).unwrap_or("").to_lowercase();
        let encoding = if charset.is_empty() {
            None // registry without a charset line: CWB defaults to latin1
        } else if CWB_CHARSETS.contains(&charset.as_str()) {
            Some(charset.clone())
        } else {
            Some(UNSUPPORTED_ENCODING.to_string())
        };
        let strs = |k: &str| -> Vec<String> {
            c.get(k).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(String::from).collect()
        };
        if let Some(known) = bundled().get(&id) {
            let mut k = known.clone();
            if let Some(e) = encoding {
                if (e == UNSUPPORTED_ENCODING) != (k.encoding == UNSUPPORTED_ENCODING) {
                    changed.push(id.clone());
                }
                k.encoding = e;
            }
            k.available = true;
            inv.insert(id, k);
        } else {
            let positional = strs("positional");
            let regions: BTreeMap<String, u64> = c
                .get("regions")
                .and_then(Value::as_object)
                .map(|m| m.iter().filter_map(|(k, v)| v.as_u64().map(|n| (k.clone(), n))).collect())
                .unwrap_or_default();
            let mut structural = BTreeMap::new();
            for s in strs("structural") {
                let n = regions.get(&s).copied().unwrap_or(0);
                structural.insert(s, n);
            }
            let metadata: Vec<String> = strs("annotated").into_iter().filter(|a| structural.contains_key(a)).collect();
            let lexeme = ["hw", "lemma"].iter().find(|a| positional.iter().any(|p| p == *a)).map(|s| s.to_string());
            let name = c.get("name").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).unwrap_or(&id).to_string();
            let (variety, variety_note) =
                infer_variety(&name, &id, c.get("language").and_then(Value::as_str).unwrap_or(""));
            inv.insert(id.clone(), CorpusInfo {
                description: name,
                tokens: c.get("tokens").and_then(Value::as_u64).unwrap_or(0),
                encoding: encoding.unwrap_or_else(|| "latin1".into()),
                positional: if positional.is_empty() { vec!["word".into()] } else { positional },
                structural,
                metadata,
                lexeme,
                available: true,
                source: "discovered".into(),
                variety,
                variety_note,
            });
            added.push(id);
        }
    }
    for (id, known) in bundled() {
        if !seen.contains(id) {
            let mut k = known.clone();
            k.available = false;
            inv.insert(id.clone(), k);
            missing.push(id.clone());
        }
    }
    Discovery { corpora: inv, added, missing, changed }
}

/// Corpus ids become part of CQP scripts, so only the registry's own id
/// alphabet is accepted (letters, digits, `_` and `-`, starting with a letter).
pub fn valid_corpus_id(id: &str) -> bool {
    let mut ch = id.chars();
    matches!(ch.next(), Some(c) if c.is_ascii_alphabetic())
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Registry charset values CWB cannot validate queries against. CQP rejects
/// *every* query on such a corpus ("unrecognised CorpusCharset"), so the app
/// refuses up front instead of sending doomed requests to the shared server.
pub const UNSUPPORTED_ENCODING: &str = "<unsupported>";

pub fn query_unsupported_message(corpus: &str) -> String {
    format!(
        "{corpus} cannot be searched with CQP on this server: its registry declares a character \
         encoding that CWB does not recognise, so CQP rejects every query before running it. \
         This is a server configuration issue, not a problem with your query. The tag inventory \
         (Annotation codes) and metadata browsing still work. Ask the corpus administrator to set \
         a valid charset (e.g. utf8 or latin1) in the {corpus} registry file."
    )
}

pub fn ensure_queryable(corpus: &str) -> AppResult<()> {
    check_queryable(corpus, all().get(corpus))
}

fn check_queryable(corpus: &str, info: Option<&CorpusInfo>) -> AppResult<()> {
    match info {
        Some(i) if !i.available => invalid(format!(
            "{corpus} is not installed on the server at the moment: it was missing from the corpus \
             registry when you connected. Choose another corpus, or reconnect later."
        )),
        Some(i) if i.encoding == UNSUPPORTED_ENCODING => invalid(query_unsupported_message(corpus)),
        _ => Ok(()),
    }
}

/// `resolve_field` from cqp_core.py: maps "lexeme" to the corpus-specific
/// attribute and rejects attributes the corpus does not index.
pub fn resolve_field(corpus: &str, field: &str) -> AppResult<String> {
    let info = get(corpus)?;
    let mut field = field.to_string();
    if field == "lexeme" {
        match &info.lexeme {
            Some(lex) if !lex.is_empty() => field = lex.clone(),
            _ => return invalid("This corpus has no indexed lemma/headword attribute"),
        }
    }
    if !info.positional.iter().any(|p| p == &field) {
        return invalid(format!("'{field}' is not available in {corpus}"));
    }
    Ok(field)
}

/// First available "where did this come from" attribute, used as the KWIC source column.
pub fn source_attribute(corpus: &str) -> Option<String> {
    let info = all().get(corpus)?;
    ["file_id", "text_id", "s_id"]
        .iter()
        .find(|a| info.metadata.iter().any(|m| m == *a))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod variety_tests {
    use super::*;

    #[test]
    fn bundled_corpora_all_have_a_variety_decision() {
        let b = bundled();
        assert_eq!(b["BNC"].variety.as_deref(), Some("en-GB"));
        assert_eq!(b["FROWN-LEGACY"].variety.as_deref(), Some("en-US"));
        assert_eq!(b["EFCAM"].variety.as_deref(), Some("en-learner"));
        assert!(b["DOORCORP"].variety.is_none());
    }

    #[test]
    fn inference_is_conservative() {
        assert_eq!(infer_variety("International Corpus of English - Australia", "ice-aus", "en").0.as_deref(), Some("en-AU"));
        assert_eq!(infer_variety("Spoken American English 2020", "sae", "").0.as_deref(), Some("en-US"));
        assert_eq!(infer_variety("British and American press", "mix", "").0, None); // ambiguous
        assert_eq!(infer_variety("Mystery corpus", "myst", "de").0.as_deref(), Some("de"));
        assert_eq!(infer_variety("Mystery corpus", "myst", "??").0, None);
    }
}

#[cfg(test)]
mod discovery_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_marks_missing_adds_new_and_tracks_charset() {
        let reply = json!({"corpora": [
            {"id": "brown-legacy", "charset": "latin1"},
            {"id": "doorcorp", "charset": "utf8"},
            {"id": "newcorp", "name": "A new corpus", "charset": "utf8", "tokens": 1234,
             "positional": ["word", "pos", "lemma"], "structural": ["text", "text_genre", "s"],
             "annotated": ["text_genre"], "regions": {"text": 10, "text_genre": 10, "s": 99}},
            {"id": "bad;id"}
        ]});
        let d = merge_registry(&reply);
        assert_eq!(d.added, vec!["NEWCORP"]);
        assert!(d.missing.contains(&"BNC".to_string()));
        assert!(!d.corpora["BNC"].available);
        assert_eq!(d.changed, vec!["DOORCORP"]); // admin fixed the charset
        assert_eq!(d.corpora["DOORCORP"].encoding, "utf8");
        let n = &d.corpora["NEWCORP"];
        assert_eq!((n.tokens, n.lexeme.as_deref(), n.source.as_str()), (1234, Some("lemma"), "discovered"));
        assert_eq!(n.metadata, vec!["text_genre"]);
        assert_eq!(n.variety, None); // "A new corpus": no place or language to go on
        assert!(!d.corpora.contains_key("BAD;ID"));
    }

    #[test]
    fn unavailable_corpus_is_refused() {
        // Pure check: the global inventory is shared by parallel tests.
        let mut bnc = bundled()["BNC"].clone();
        assert!(check_queryable("BNC", Some(&bnc)).is_ok());
        bnc.available = false;
        assert!(check_queryable("BNC", Some(&bnc)).unwrap_err().to_string().contains("not installed"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_matches_python() {
        assert_eq!(all().len(), 10);
        assert_eq!(resolve_field("BNC-BABY", "lexeme").unwrap(), "hw");
        assert_eq!(resolve_field("CLMET", "lexeme").unwrap(), "lemma");
        assert!(resolve_field("BROWN-LEGACY", "lexeme").is_err());
        assert_eq!(source_attribute("BROWN-LEGACY").as_deref(), Some("file_id"));
        assert_eq!(source_attribute("BNC").as_deref(), Some("text_id"));
        assert!(ensure_queryable("DOORCORP").is_err());
        assert!(ensure_queryable("BNC").is_ok());
    }
}
