//! Checking a CQP query typed by hand ("Write CQP" in Search).
//!
//! The text becomes `GUIQuery = <text>;` in a script that the remote worker
//! feeds to CQP, so it must stay one query expression and never become a
//! command. This module lexes the text the way CQP does and allows only what a
//! query expression needs:
//!
//! - quoted values ("…" or '…', with CQP's backslash escapes) and %c/%d/%l flags;
//! - names that are attributes of the chosen corpus, a fixed list of query
//!   keywords, the `_` label and labels the query itself defines (`a:[…]`);
//! - numbers and the query operators `[ ] ( ) { } < > / = ! & | ? * + , . : @ -`.
//!
//! Refused anywhere outside a value: `;` (ends the statement), `#`, `$`, a
//! backslash, backticks and line breaks; inside a value: `;`, quotes and control
//! characters. A `>` that does not close a `<tag>` may not be followed by a
//! value or another `>`, so `> "file"` redirection cannot be written either.

use crate::corpora::CorpusInfo;
use crate::error::{invalid, AppResult};

pub const MAX_LEN: usize = 600;
const MAX_LEXEMES: usize = 400;

/// Query words CQP understands inside an expression. Command words (cat,
/// save, set, exit, define, …) are deliberately absent.
const KEYWORDS: [&str; 20] = [
    "within", "match", "matchend", "target", "keyword", "expand", "to", "left", "right", "cut",
    "contains", "matches", "distance", "distabs", "lbound", "rbound", "lbound_of", "rbound_of", "int", "ambiguity",
];
/// Names that may be followed by `.attr` (besides labels the query defines).
const ANCHORS: [&str; 5] = ["_", "match", "matchend", "target", "keyword"];

#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    /// The query on one line, as it will run.
    pub expression: String,
    /// Byte offset of the first `::` outside values, if any.
    pub constraint_at: Option<usize>,
    /// Uses `cut` (a result limit), which must stay last.
    pub has_cut: bool,
    /// The query is exactly `[]`: every token.
    pub all_tokens: bool,
}

#[derive(Debug, Clone, PartialEq)]
enum Lex {
    Str,
    Flag,
    Name(String),
    Num,
    Punct(char),
}

fn names(info: &CorpusInfo) -> String {
    let st: Vec<&str> = info.structural.keys().map(String::as_str).collect();
    let mut out = info.positional.join(", ");
    if !st.is_empty() {
        out.push_str(&format!("; structural: {}", st[..st.len().min(6)].join(", ")));
        if st.len() > 6 {
            out.push_str(&format!(" and {} more", st.len() - 6));
        }
    }
    out
}

/// Check `text` for `corpus` and return it on one line.
pub fn check(corpus: &str, info: &CorpusInfo, text: &str) -> AppResult<Checked> {
    // Line breaks and tabs are only layout; the query runs on one line.
    let flat: String = text.chars().map(|c| if matches!(c, '\n' | '\r' | '\t') { ' ' } else { c }).collect();
    let src = flat.trim();
    if src.is_empty() {
        return invalid("Type a CQP query, for example [pos=\"NN1\"] — or [] for every word.");
    }
    if src.chars().count() > MAX_LEN {
        return invalid(format!("A CQP query can have at most {MAX_LEN} characters"));
    }
    if let Some(c) = src.chars().find(|c| c.is_control()) {
        return invalid(format!("The query contains a control character (U+{:04X})", c as u32));
    }

    let chars: Vec<(usize, char)> = src.char_indices().collect();
    let mut lexes: Vec<(usize, Lex)> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (at, c) = chars[i];
        if c == ' ' {
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            let mut j = i + 1;
            loop {
                let Some(&(_, d)) = chars.get(j) else {
                    return invalid(format!("A value starting at character {} has no closing {c}", at + 1));
                };
                if d == c {
                    break;
                }
                if d == ';' {
                    return invalid("Values in a CQP query can't contain a semicolon");
                }
                if d == '\\' {
                    // CQP reads backslash + next character as one escape, as here.
                    match chars.get(j + 1) {
                        Some(&(_, '"')) | Some(&(_, '\'')) => {
                            return invalid("Values in a CQP query can't contain quotation marks");
                        }
                        Some(_) => j += 2,
                        None => return invalid("A value ends with a backslash"),
                    }
                    continue;
                }
                if (d == '"' || d == '\'') && d != c {
                    return invalid("Values in a CQP query can't contain quotation marks");
                }
                j += 1;
            }
            lexes.push((at, Lex::Str));
            i = j + 1;
            continue;
        }
        if c == '%' {
            let mut j = i + 1;
            while chars.get(j).is_some_and(|&(_, d)| matches!(d, 'c' | 'd' | 'l')) {
                j += 1;
            }
            if j == i + 1 || chars.get(j).is_some_and(|&(_, d)| d.is_ascii_alphanumeric()) {
                return invalid("After a value, only the flags %c (ignore case), %d (ignore accents) and %l (literal) are allowed");
            }
            lexes.push((at, Lex::Flag));
            i = j;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while chars.get(j).is_some_and(|&(_, d)| d.is_ascii_alphanumeric() || d == '_') {
                j += 1;
            }
            let end = chars.get(j).map(|&(b, _)| b).unwrap_or(src.len());
            lexes.push((at, Lex::Name(src[at..end].to_string())));
            i = j;
            continue;
        }
        if c.is_ascii_digit() {
            let mut j = i;
            while chars.get(j).is_some_and(|&(_, d)| d.is_ascii_digit()) {
                j += 1;
            }
            lexes.push((at, Lex::Num));
            i = j;
            continue;
        }
        if "[](){}<>/=!&|?*+,.:@-".contains(c) {
            lexes.push((at, Lex::Punct(c)));
            i += 1;
            continue;
        }
        let what = match c {
            ';' => "a semicolon (it would end the query and start a command)".to_string(),
            '\\' => "a backslash outside a quoted value".to_string(),
            _ => format!("“{c}”"),
        };
        return invalid(format!("CQP queries here can't contain {what} (character {})", at + 1));
    }
    if lexes.len() > MAX_LEXEMES {
        return invalid("The query is too long; split it into simpler searches");
    }

    // Labels the query defines: a name directly followed by a single ':'.
    let mut labels: Vec<String> = Vec::new();
    for w in lexes.windows(3) {
        if let (Lex::Name(n), Lex::Punct(':')) = (&w[0].1, &w[1].1) {
            let double = matches!(w[2].1, Lex::Punct(':')) && w[2].0 == w[1].0 + 1;
            if !double {
                labels.push(n.clone());
            }
        }
    }
    if let [.., (_, Lex::Name(n)), (_, Lex::Punct(':'))] = lexes.as_slice() {
        labels.push(n.clone());
    }

    let attrs = |n: &str| info.positional.iter().any(|p| p == n) || info.structural.contains_key(n);
    let mut stack: Vec<char> = Vec::new();
    let mut in_tag = false;
    let mut constraint_at = None;
    let mut has_cut = false;
    let mut patterns = 0usize;
    for (k, (at, lex)) in lexes.iter().enumerate() {
        let next = lexes.get(k + 1).map(|x| &x.1);
        match lex {
            Lex::Name(n) => {
                if n == "cut" {
                    has_cut = true;
                }
                let anchor = ANCHORS.contains(&n.as_str()) || labels.contains(n);
                let dotted = matches!(next, Some(Lex::Punct('.')));
                if dotted && !anchor && !attrs(n) {
                    return invalid(format!("Unknown label “{n}”. Define it first, as in {n}:[pos=\"NN1\"], or use _ for the current word"));
                }
                if !(attrs(n) || KEYWORDS.contains(&n.as_str()) || anchor || labels.contains(n)) {
                    return invalid(format!("“{n}” is not an attribute of {corpus} or a CQP query keyword. Attributes: {}", names(info)));
                }
                // After `label.` comes an attribute.
                if k >= 2 {
                    if let (Lex::Punct('.'), Lex::Name(prev)) = (&lexes[k - 1].1, &lexes[k - 2].1) {
                        if (ANCHORS.contains(&prev.as_str()) || labels.contains(prev)) && !attrs(n) {
                            return invalid(format!("“{prev}.{n}”: {corpus} has no attribute “{n}”. Attributes: {}", names(info)));
                        }
                    }
                }
            }
            Lex::Str => patterns += 1,
            Lex::Punct(c) => {
                match c {
                    '[' | '(' | '{' => stack.push(*c),
                    ']' | ')' | '}' => {
                        let open = match c { ']' => '[', ')' => '(', _ => '{' };
                        if stack.pop() != Some(open) {
                            return invalid(format!("Unbalanced “{c}” at character {}", at + 1));
                        }
                        if *c == ']' {
                            patterns += 1;
                        }
                    }
                    '<' if stack.is_empty() => {
                        in_tag = true;
                        patterns += 1;
                    }
                    '>' => {
                        if in_tag && stack.is_empty() {
                            in_tag = false;
                        } else if matches!(next, Some(Lex::Str) | Some(Lex::Punct('>'))) {
                            return invalid("A “>” comparison can't be followed by a quoted value here");
                        }
                    }
                    ':' => {
                        if matches!(next, Some(Lex::Punct(':'))) && lexes[k + 1].0 == at + 1 && constraint_at.is_none() {
                            if !stack.is_empty() {
                                return invalid("“::” (conditions on the whole match) must come after the token patterns, outside brackets");
                            }
                            constraint_at = Some(*at);
                        }
                    }
                    _ => {}
                }
            }
            Lex::Flag | Lex::Num => {}
        }
    }
    if let Some(open) = stack.pop() {
        return invalid(format!("“{open}” is never closed"));
    }
    if in_tag {
        return invalid("A “<” tag is never closed with “>”");
    }
    if patterns == 0 {
        return invalid("The query needs at least one token pattern, such as [pos=\"NN1\"] or \"word\" — or [] for every word");
    }

    // Normalise runs of spaces (outside values the lexer already skipped them).
    let expression = collapse_spaces(src);
    let all_tokens = expression.replace(' ', "") == "[]";
    let constraint_at = constraint_at.map(|_| {
        // Recompute on the collapsed text: the first "::" outside values.
        first_outside_values(&expression, "::").unwrap_or(0)
    });
    Ok(Checked { expression, constraint_at, has_cut, all_tokens })
}

/// Collapse runs of spaces outside quoted values.
fn collapse_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut prev_space = false;
    for c in s.chars() {
        if let Some(q) = quote {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if c == ' ' {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
            continue;
        }
        prev_space = false;
        if c == '"' || c == '\'' {
            quote = Some(c);
        }
        out.push(c);
    }
    out
}

fn first_outside_values(s: &str, needle: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (i, c) in s.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
        } else if s[i..].starts_with(needle) {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::corpora;

    fn ok(corpus: &str, q: &str) -> Checked {
        check(corpus, corpora::get(corpus).unwrap(), q).unwrap_or_else(|e| panic!("{q}: {e}"))
    }
    fn err(corpus: &str, q: &str) -> String {
        match check(corpus, corpora::get(corpus).unwrap(), q) {
            Ok(c) => panic!("accepted {q:?} as {:?}", c.expression),
            Err(e) => e.to_string(),
        }
    }

    #[test]
    fn ordinary_queries_pass() {
        let c = ok("BNC", "[pos=\"VV.*\"] [pos=\"AT0\"]? [hw=\"time\" %c]");
        assert_eq!(c.expression, "[pos=\"VV.*\"] [pos=\"AT0\"]? [hw=\"time\" %c]");
        ok("BNC", "\"the\" []{0,3} [class=\"SUBST\"] within s");
        ok("BNC", "a:[pos=\"AJ0\"] [] b:[pos=\"NN1\"] :: a.hw = b.hw");
        ok("BNC", "<s> [word=\"well\"%c] :: match.text_text_type=\"SPOKEN.*\"");
        ok("BNC", "[word=\"a\\.b\"] | [word='its']");
        ok("BNC", "@[pos=\"NN1\"] [word=\"of\"]");
        ok("BNC", "[_.text_genre=\"W:ac.*\"]");
        ok("EFCAM", "[rel=\"nsubj\" & pos=\"PRP\"]");
        let multi = ok("BNC", "[pos=\"AJ0\"]\n  [pos=\"NN1\"]");
        assert_eq!(multi.expression, "[pos=\"AJ0\"] [pos=\"NN1\"]");
        assert!(ok("BNC", " [ ] ").all_tokens);
        let c = ok("BNC", "[word=\"go\"] :: match.text_id=\"A0.*\"");
        assert_eq!(&c.expression[c.constraint_at.unwrap()..c.constraint_at.unwrap() + 2], "::");
        assert!(ok("BNC", "[word=\"go\"] cut 10").has_cut);
    }

    #[test]
    fn commands_and_escapes_are_refused() {
        for q in [
            "[word=\"x\"]; cat GUIQuery > \"/tmp/x\"",
            "[word=\"x\"] ; exit",
            "[word=\"x\"]\u{0}",
            "[word=\"a\\\" x \"; exit; \"\"]",
            "[word=\"x;y\"]",
            "[word=\"x\"] > \"/tmp/out\"",
            "[word=\"x\"] >> \"f\"",
            "[word=\"x\"] # comment",
            "[word=$x]",
            "[word=\"x\"] `ls`",
            "cat GUIQuery",
            "set Context 4",
            "[word=\"x\"] \\ ",
            "[foo=\"x\"]",
            "[word=\"x\"",
            "[word=\"x]",
            "word",
            "",
        ] {
            err("BNC", q);
        }
        assert!(err("BROWN-LEGACY", "[hw=\"go\"]").contains("not an attribute of BROWN-LEGACY"));
        assert!(err("BNC", "z.word=\"x\"").contains("Unknown label"));
    }
}
