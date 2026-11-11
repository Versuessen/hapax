//! Translate GUI requests into commands you can paste into your own SSH session.
//!
//! Two styles:
//! - `Cqp`:   lines for the interactive `cqp>` prompt (start CQP yourself first).
//! - `Shell`: a self-contained bash snippet: sets LD_LIBRARY_PATH the same way the
//!            app's remote worker does (non-interactive shells lack it, handoff F3),
//!            then runs CQP / CWB with the commands on stdin.
//!
//! The output is human-oriented: `cat` (readable KWIC) instead of the app's
//! machine-oriented `tabulate`, but the *query expressions, set operations,
//! grouping anchors and seeds are exactly the ones the app runs*, because they
//! come from the same validated payload builders.

use serde_json::Value;

use crate::corpora::CWB_REGISTRY;

const CWB_ROOT: &str = "/home/s/structeng/cwb";
const COLLOCATES: &str = "/home/s/structeng/scripts/collocates.pl";

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Style {
    Cqp,
    Shell,
}

impl Style {
    pub fn parse(s: &str) -> Style {
        if s.eq_ignore_ascii_case("shell") { Style::Shell } else { Style::Cqp }
    }
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn n(v: &Value, k: &str) -> i64 {
    v[k].as_i64().unwrap_or(0)
}

fn lib_path_line() -> String {
    format!(
        "export LD_LIBRARY_PATH=\"$(dirname \"$(find {CWB_ROOT} -name libcl.so -print -quit)\")${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}\""
    )
}

fn cqp_bin() -> String {
    format!("{CWB_ROOT}/bin/cqp")
}

/// Script body for the cqp> prompt; `None` for ops that are not CQP (decoders).
fn cqp_body(p: &Value) -> Option<String> {
    let src = p["source_attribute"].as_str();
    let print_src = src.map(|a| format!("set PrintStructures \"{a}\";\n")).unwrap_or_default();
    let query = |corpus: &str, expr: &str, name: &str| format!("{corpus};\n{name} = {expr};\nsize {name};");
    match s(p, "op") {
        "search" | "export" => {
            let (off, lim, ctx) = (n(p, "offset"), n(p, "limit"), n(p, "context").max(1));
            let sort = crate::query::sort_command(s(p, "sort")).ok().flatten()
                .map(|c| format!("\n{}", c.replace("GUIQuery", "Hits"))).unwrap_or_default();
            Some(format!(
                "set Context {ctx} words;\n{print_src}{}{sort}\ncat Hits {off} {};",
                query(s(p, "corpus"), s(p, "expression"), "Hits"),
                off + lim - 1
            ))
        }
        "frequencies" if s(p, "group_anchor") == "phrase" => Some(format!(
            "{}\ncount Hits by {}{};   # each distinct matched phrase, most frequent first",
            query(s(p, "corpus"), s(p, "expression"), "Hits"),
            s(p, "group_field"),
            if p["fold_case"].as_bool() == Some(true) { " %c" } else { "" }
        )),
        "frequencies" => Some(format!(
            "{}\ngroup Hits {} {};",
            query(s(p, "corpus"), s(p, "expression"), "Hits"),
            s(p, "group_anchor"),
            s(p, "group_field")
        )),
        "collocates" => Some(format!(
            "set Context 4 words;\n{}\ncat Hits 0 {} > \"| {COLLOCATES} --list --case /dev/stdin\";",
            query(s(p, "corpus"), s(p, "expression"), "Hits"),
            n(p, "sample_limit") - 1
        )),
        "compare" => {
            let mut out = Vec::new();
            for c in p["compiled"].as_array().into_iter().flatten() {
                let (corpus, expr, tokens) = (c[0].as_str().unwrap_or(""), c[1].as_str().unwrap_or(""), c[2].as_u64().unwrap_or(0));
                out.push(format!("{}\n# per million = size × 1000000 / {tokens}", query(corpus, expr, "Hits")));
            }
            Some(out.join("\n\n"))
        }
        "workflow" => {
            // Script lines 3.. are the step assignments (lines 1–2 are PrettyPrint + corpus).
            let script = s(p, "script");
            let mut lines = script.lines();
            let _pp = lines.next();
            let corpus = lines.next().unwrap_or("");
            let mut out = vec![corpus.to_string()];
            for l in lines {
                out.push(l.to_string());
                if let Some(name) = l.split(" = ").next().filter(|x| x.starts_with('Q')) {
                    out.push(format!("size {name};"));
                }
            }
            let last = s(p, "result_name");
            let ctx = n(p, "context").max(1);
            match s(p, "mode") {
                "group" => out.push(format!("group {last} {} {};", s(p, "group_anchor"), s(p, "group_field"))),
                "sample" => {
                    out.push(format!("set Context {ctx} words;"));
                    if let Some(a) = src { out.push(format!("set PrintStructures \"{a}\";")); }
                    out.push(format!("Sample = {last};"));
                    out.push(format!("sort Sample randomize {};", n(p, "seed")));
                    out.push(format!("cat Sample 0 {};", n(p, "limit") - 1));
                }
                _ => {
                    out.push(format!("set Context {ctx} words;"));
                    if let Some(a) = src { out.push(format!("set PrintStructures \"{a}\";")); }
                    let off = n(p, "offset");
                    out.push(format!("cat {last} {off} {};", off + n(p, "limit") - 1));
                }
            }
            Some(format!(
                "# If any step reports size 0, do not run a later `subset` on it:\n# CQP 3.5.1 can abort on subsets of empty results (the app skips them).\n{}",
                out.join("\n")
            ))
        }
        "distribution" => Some(format!(
            "{}\ngroup Hits match {};   # hits per value; divide by each value's token count (Corpora › Metadata) for rates",
            query(s(p, "corpus"), s(p, "expression"), "Hits"),
            s(p, "attribute")
        )),
        "health" => Some("show cd;   # CQP is running; `cqp -v` in the shell prints the version".into()),
        _ => None,
    }
}

/// Shell commands for ops that use CWB decoders instead of CQP.
fn decoder_shell(p: &Value) -> Option<String> {
    let bin = format!("{CWB_ROOT}/bin");
    match s(p, "op") {
        "registry" => Some(format!("ls {CWB_REGISTRY}\n{bin}/cwb-describe-corpus -s -r {CWB_REGISTRY} <CORPUS>   # size and attributes of one corpus")),
        "lexicon" => Some(format!("{bin}/cwb-lexdecode -r {CWB_REGISTRY} -f -P {} {} | sort -nr | head -100", s(p, "field"), s(p, "corpus"))),
        "metadata" => Some(format!(
            "{bin}/cwb-s-decode -r {CWB_REGISTRY} {} -S {} | awk -F'\\t' '{{n[$3]++; t[$3]+=$2-$1+1}} END {{for (v in n) print t[v] \"\\t\" n[v] \"\\t\" v}}' | sort -nr | head -100\n# columns: tokens, regions, value",
            s(p, "corpus"),
            s(p, "attribute")
        )),
        "syntax" => {
            let pos = n(p, "position");
            Some(format!(
                "# 1) sentence-local id of the token:\n{bin}/cwb-decode -r {CWB_REGISTRY} -C -s {pos} -e {pos} EFCAM -P tokid\n# 2) with START = {pos} - tokid + 1, decode the sentence:\n{bin}/cwb-decode -r {CWB_REGISTRY} -C -s START -e $((START+254)) EFCAM -P word -P pos -P lemma -P tokid -P head -P rel"
            ))
        }
        _ => None,
    }
}

pub fn render(p: &Value, style: Style, title: &str) -> String {
    let header = format!("# Hapax — {title}\n# Generated {} · read-only commands", chrono::Utc::now().format("%Y-%m-%d %H:%M UTC"));
    if let Some(body) = cqp_body(p) {
        return match style {
            Style::Cqp => format!(
                "{header}\n# Start CQP first:  {} -e -r {CWB_REGISTRY}\n# then paste at the cqp> prompt:\n\n{body}\n",
                cqp_bin()
            ),
            Style::Shell => format!(
                "{header}\n{}\n{} -r {CWB_REGISTRY} <<'CQP'\n{body}\nCQP\n",
                lib_path_line(),
                cqp_bin()
            ),
        };
    }
    if let Some(cmd) = decoder_shell(p) {
        let note = if style == Style::Cqp { "# This is a shell command (not CQP); run it at the bash prompt, not at cqp>.\n" } else { "" };
        return format!("{header}\n{note}{}\n{cmd}\n", lib_path_line());
    }
    format!("{header}\n# No terminal equivalent for this request.\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn search_both_styles() {
        let p = json!({"op":"search","corpus":"BROWN-LEGACY","expression":"[word=\"jury\" %c]","offset":0,"limit":25,"context":4,"source_attribute":"file_id"});
        let c = render(&p, Style::Cqp, "t");
        assert!(c.contains("BROWN-LEGACY;\nHits = [word=\"jury\" %c];\nsize Hits;\ncat Hits 0 24;"));
        assert!(c.contains("set PrintStructures \"file_id\";"));
        let sh = render(&p, Style::Shell, "t");
        assert!(sh.contains("export LD_LIBRARY_PATH="));
        assert!(sh.contains("/home/s/structeng/cwb/bin/cqp -r /home/s/structeng/firth/registry <<'CQP'"));
        assert!(sh.trim_end().ends_with("CQP"));
    }

    #[test]
    fn workflow_adds_sizes_and_group() {
        let p = json!({"op":"workflow","mode":"group","result_name":"Q2","group_anchor":"matchend","group_field":"word","context":4,
            "script":"set PrettyPrint off;\nBNC-BABY;\nQ1 = [hw=\"deliver\"] [class=\"ADV\"] within s;\nQ2 = subset Q1 where match: [pos=\"VVD\"];\n"});
        let c = render(&p, Style::Cqp, "t");
        assert!(c.contains("BNC-BABY;\nQ1 = [hw=\"deliver\"] [class=\"ADV\"] within s;\nsize Q1;\nQ2 = subset Q1"));
        assert!(c.contains("group Q2 matchend word;"));
    }

    #[test]
    fn decoders_are_shell() {
        let p = json!({"op":"lexicon","corpus":"BNC","field":"pos"});
        assert!(render(&p, Style::Cqp, "t").contains("cwb-lexdecode -r /home/s/structeng/firth/registry -f -P pos BNC"));
    }
}
