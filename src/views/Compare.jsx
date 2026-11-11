import { useState } from "react";
import { FileDown, Scale } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, saveDialog } from "../lib/ipc.js";
import { Button, Card, Notice, ScrollTable } from "../components/ui.jsx";
import { BarCell } from "../components/charts.jsx";
import { Flag } from "../components/Flag.jsx";
import { FilterEditor } from "../components/FilterEditor.jsx";
import { UnitLabel, useUnits } from "../components/Units.jsx";
import { describeFilter, filtersOf } from "../lib/filters.js";
import { exportReport } from "../lib/exportReport.js";
import { seconds, thousands } from "../lib/format.js";
import { queryLabel } from "../lib/query.js";
import { useUiState } from "../lib/uiState.js";
import { corpusColor, isSearchable, orderedCorpora } from "../nav.js";
import { BaseNotice, useBase, useRunView } from "./Analyses.jsx";

/**
 * Search › Compare: the search on the left, run in up to six corpora (the
 * search's own corpus is the reference), each other corpus with its own
 * document filters; rates and log-likelihood against the reference.
 */
/** Log-likelihood (G²) for one count pair (Rayson & Garside 2000). */
export function logLikelihood(a, c, b, d) {
  const e1 = (c * (a + b)) / (c + d), e2 = (d * (a + b)) / (c + d);
  const t = (o, e) => (o > 0 ? o * Math.log(o / e) : 0);
  return 2 * (t(a, e1) + t(b, e2));
}
const stars = (ll) => (ll >= 10.83 ? "***" : ll >= 6.63 ? "**" : ll >= 3.84 ? "*" : "");

export function CompareView() {
  const { info, run, toast, log, busy } = useApp();
  const b = useBase();
  const runView = useRunView();
  const names = orderedCorpora(info);
  const base = b.base;
  // The search's corpus is the reference; the user adds corpora to compare (remembered).
  const [extra, setExtra] = useUiState("compare.corpora", []);
  const corpora = base ? [base.corpus, ...extra.filter((c) => c !== base.corpus && isSearchable(info?.corpora?.[c]))].slice(0, 6) : [];
  const [filters, setFilters] = useState({}); // other corpus -> its own document filters
  const [openFilters, setOpenFilters] = useState(null);
  const [res, setRes] = useState(null);
  const own = base ? filtersOf(base).filter((f) => f.attr) : [];
  const query = base ? { ...base, meta_attr: "", meta_value: "", filters: [] } : null;
  const active = Object.fromEntries(corpora.map((c) => [c, c === base?.corpus ? own : (filters[c] || []).filter((f) => f.attr)]).filter(([, l]) => l.length));
  const request = { corpora, query, filters: active };
  const toggle = (c) => setExtra((list) => (list.includes(c) ? list.filter((x) => x !== c) : list.length >= 5 ? list : [...list, c]));
  const go = async () => {
    if (corpora.length < 2) return toast("Select at least one more corpus to compare with.", "warning");
    const out = await run(`Comparing ${corpora.length} corpora`, "run_compare", { request }, { retry: () => go() });
    if (out) {
      setRes({ key: b.key, req: request, data: out.data, elapsed: out.elapsed_seconds });
      log({ label: `Compared “${queryLabel(base)}” in ${corpora.join(", ")}`, detail: seconds(out.elapsed_seconds) });
    }
  };
  runView.current = () => !busy && go();
  const shownRes = res && res.key === b.key ? res : null;
  const rows = shownRes?.data?.results || [];
  const ref = rows[0];
  const related = corpora.includes("BNC") && corpora.includes("BNC-BABY");
  const units = useUnits(rows.map((r) => r.corpus));
  const shown = rows.map((r) => units.per(r.total, r.corpus, r.tokens));
  const max = Math.max(1e-9, ...shown.map((d) => d.value));
  if (!base) return <BaseNotice b={b} />;
  return (
    <div className="stack">
      <Card title="Compare across corpora" sub="Runs the search on the left in each corpus — normalised rates, with log-likelihood against the first"
        actions={<Button variant="primary" icon={Scale} onClick={go} disabled={!!busy || !base || corpora.length < 2} title="Compare (Ctrl+Shift+Enter)">Compare</Button>}>
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <div className="field__label" id="cmp-corpora">Corpora <span className="muted">({corpora.length < 2 ? `select ${2 - corpora.length} more` : `${corpora.length} of 6`} · the first is the reference)</span></div>
            <div className="row" role="group" aria-labelledby="cmp-corpora" style={{ gap: 8, marginTop: 6 }}>
              {names.map((c) => {
                const on = corpora.includes(c);
                const unq = !isSearchable(info?.corpora?.[c]);
                return (
                  <button key={c} type="button" className={`chip-toggle${on ? " is-on" : ""}`} aria-pressed={on} disabled={unq || c === base.corpus || (!on && corpora.length >= 6)} onClick={() => toggle(c)} title={unq ? "Not searchable on this server" : ""}>
                    <Flag variety={info.corpora[c].variety} note={info.corpora[c].variety_note} size={14} />{c}{on && corpora[0] === c ? " · ref" : ""}
                  </button>
                );
              })}
            </div>
            {corpora.length > 0 && <div className="section-label" style={{ marginTop: 14 }}>Only in documents where</div>}
            {corpora.length > 0 && (
              <ul className="cmp-filters" aria-label="Document filters per corpus">
                {corpora.map((c) => {
                  const list = c === base.corpus ? own : filters[c] || [];
                  const desc = list.map(describeFilter).filter(Boolean);
                  return (
                    <li key={c}>
                      <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                        <span style={{ minWidth: 130, fontWeight: 500 }}>{c}</span>
                        <span className="muted" style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-mono)" }}>{desc.length ? desc.join(" · ") : "whole corpus"}{c === base.corpus ? " · from the search" : ""}</span>
                        {c !== base.corpus && (
                          <button type="button" className="btn btn--ghost" aria-expanded={openFilters === c} onClick={() => setOpenFilters(openFilters === c ? null : c)}>
                            {list.length ? "Edit filters" : "Filter"}
                          </button>
                        )}
                      </div>
                      {openFilters === c && (
                        <div style={{ padding: "8px 0 4px" }}>
                          <FilterEditor corpus={c} filters={list} idPrefix={`cf-${c}`} compact onChange={(l) => setFilters((m) => ({ ...m, [c]: l }))} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <span className="muted" style={{ fontSize: "var(--fs-mono)" }}>Filters are set per corpus, because metadata differs between corpora; {base?.corpus}'s come from the search. Fields such as “lexeme” resolve per corpus.</span>
        </div>
        {related && <div style={{ marginTop: 12 }}><Notice tone="warn">BNC-BABY is a subset of the BNC; their rates are not independent evidence.</Notice></div>}
      </Card>
      {shownRes && rows.some((r) => r.subcorpus && !r.subcorpus_measured) && (
        <Notice tone="warn">
          The size of the filtered part could not be measured for {rows.filter((r) => r.subcorpus && !r.subcorpus_measured).map((r) => r.corpus).join(", ")}: its filters use attributes divided into different regions (for example text and utterance). Matches are filtered, but the rate divides by the whole corpus, so it is too low. Filter on one level, such as text attributes only, for a correct rate.
        </Notice>
      )}
      {shownRes && (
        <Card flush title={`${rows.length} corpora · reference ${ref?.corpus}`} sub={`${seconds(shownRes.elapsed)} · LL (G², on token counts): * p<.05, ** p<.01, *** p<.001 (3.84 / 6.63 / 10.83). Treats tokens as independent; genre, period and tagging differences still limit inference`}
          actions={<Button icon={FileDown} onClick={async () => { const p = await saveDialog({ defaultPath: "corpus_comparison.csv" }); if (p) exportReport(toast, log, "Exported comparison", invoke("export_comparison", { path: p, request: shownRes.req, result: shownRes.data })); }}>Export…</Button>}>
          <div className="table-scroll">
            <table className="table" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <thead><tr><th>Corpus</th><th className="num">Matches</th><th className="num"><button type="button" className="unit-toggle" onClick={units.toggle} title={`${units.unit === "words" ? "Words" : "Tokens"} in the corpus, or in its filtered part. Click to switch to ${units.unit === "words" ? "tokens" : "words"}.`}>{units.unit === "words" ? "Words" : "Tokens"} searched</button></th><th style={{ width: "26%" }}><span className="sr-only">Share</span></th><th className="num"><UnitLabel corpora={rows.map((r) => r.corpus)} prefix="Per million" /></th><th className="num">× ref</th><th className="num">LL vs ref</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const ll = i && ref ? logLikelihood(r.total, r.tokens, ref.total, ref.tokens) : null;
                  const d = shown[i];
                  const ratio = i && shown[0]?.value ? d.value / shown[0].value : null;
                  return (
                    <tr key={r.corpus}>
                      <td>
                        <span className="row" style={{ flexWrap: "nowrap" }}><Flag variety={info?.corpora?.[r.corpus]?.variety} note={info?.corpora?.[r.corpus]?.variety_note} size={14} />{r.corpus}</span>
                        {r.subcorpus && (
                          <div className="muted" style={{ fontSize: "var(--fs-micro)", marginTop: 2 }} title={(shownRes.req.filters[r.corpus] || []).map(describeFilter).join("; ")}>
                            {r.subcorpus_measured ? "filtered part" : "filtered · rate uses whole corpus"}
                          </div>
                        )}
                      </td>
                      <td className="num">{thousands(r.total)}</td><td className="num">{d.approx ? "≈ " : ""}{thousands(d.n)}</td>
                      <td><BarCell value={d.value} max={max} color={corpusColor(r.corpus)} /></td>
                      <td className="num" title={d.approx ? "Estimated: the filtered part's word count is the corpus's share of words applied to its tokens" : undefined}>{d.approx ? "≈ " : ""}{d.value.toFixed(2)}</td>
                      <td className="num">{i === 0 ? "ref" : ratio != null ? `${ratio.toFixed(2)}×` : "—"}</td>
                      <td className="num">{i === 0 ? "—" : `${ll.toFixed(2)}${stars(ll)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

