import { describeFilters } from "../lib/filters.js";
import { PageHeader } from "../components/PageHeader.jsx";
import { describeFollowers, followersOf } from "../lib/sequence.js";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, FileDown, Play, Search as SearchIcon, Sparkles, TextSearch } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { invoke, openExternal, saveDialog } from "../lib/ipc.js";
import { Button, Card, Checkbox, EmptyState, Field, ICON, Input, Notice, Segmented, Select, Chip, Tabs } from "../components/ui.jsx";
import { BarCell, SERIES } from "../components/charts.jsx";
import { FIELD_LABELS } from "../components/QueryBuilder.jsx";
import { CollocationChart, POSITIONS, collocationSeries } from "./Overview.jsx";
import { exportReport } from "./Search.jsx";
import { safeFileStem, seconds, thousands } from "../lib/format.js";
import { corpusColor, isSearchable, orderedCorpora } from "../nav.js";
import { Flag } from "../components/Flag.jsx";
import { FilterEditor } from "../components/FilterEditor.jsx";

const GROUPABLE = ["word", "lexeme", "pos", "class", "lemma", "hw", "rel", "usas"];

export async function runCollocates({ run, query, sample, key }) {
  const out = await run(`Counting neighbouring words`, "run_collocates", { request: { ...query, sample_limit: sample } });
  return out ? { key, query, data: out.data, elapsed: out.elapsed_seconds } : null;
}

/** The base query for analysis: the last search if still current (v3 rule). */
function useBase() {
  const { search, query } = useApp();
  if (search && search.key === queryKey(query)) return { base: search.request, key: search.key, total: search.data.total };
  if (search) return { stale: true };
  if (query.value) return { base: query, key: queryKey(query), total: null };
  return { none: true };
}

function BaseNotice({ b }) {
  const { setScreen } = useApp();
  if (b.none)
    return (
      <Card>
        <EmptyState icon={TextSearch} title="Nothing to analyse yet" action={<Button variant="primary" onClick={() => setScreen("search")}>Open search</Button>}>
          Analyses run on your current search query. Build one on the Search screen first.
        </EmptyState>
      </Card>
    );
  if (b.stale)
    return (
      <Notice tone="warn">
        You changed the query since the last search. Run <strong>Search</strong> again first, so the analysis describes the results you are looking at.{" "}
        <Button variant="ghost" onClick={() => setScreen("search")}>Go to search</Button>
      </Notice>
    );
  return null;
}

function QuerySummary({ q }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <Chip dot={corpusColor(q.corpus)}>{q.corpus}</Chip>
      <Chip>{q.field} = {q.value}{q.ignore_case ? " %c" : ""}</Chip>
      {describeFollowers(q).map((d) => <Chip key={d}>{d}</Chip>)}
      {q.sentence_only && <Chip>within s</Chip>}
      {describeFilters(q).map((d) => <Chip key={d} tone="warn">{d}</Chip>)}
    </div>
  );
}

export function ExplainPanel({ corpus, field, value, onClose }) {
  const [ex, setEx] = useState(null);
  useEffect(() => {
    if (!value) return;
    invoke("explain_annotation", { corpus, field, value }).then(setEx).catch(() => setEx(null));
  }, [corpus, field, value]);
  if (!value || !ex) return null;
  return (
    <Card title={<><strong className="mono">{value}</strong> · {field}</>} sub={ex.verified ? "Verified codebook entry" : "Not verified for this corpus"} actions={onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="stack" style={{ gap: 10 }}>
        <div style={{ fontSize: 16 }}>{ex.short}</div>
        {ex.full !== ex.short && <div style={{ color: "var(--text-2)" }}>{ex.full}</div>}
        <div style={{ color: "var(--text-2)", fontSize: 13 }}>{ex.note}</div>
        {ex.reference && (
          <div><Button variant="ghost" icon={ExternalLink} onClick={() => openExternal(ex.reference)}>Tagset source</Button></div>
        )}
      </div>
    </Card>
  );
}

/** Which word of the match to count: options depend on the search's shape. */
function positionOptions(q) {
  const words = [q.value, ...followersOf(q).map((w) => w.value)];
  const opts = [];
  if (words.length === 1) {
    opts.push(["first", "The matched word"]);
  } else {
    words.forEach((w, i) => opts.push([`word:${i + 1}`, `Word ${i + 1} · ${w}`]));
    opts.push(["phrase", "The whole matched phrase"]);
  }
  opts.push(["before", "The word just before the match"], ["after", "The word just after the match"]);
  return opts;
}

function positionHint(pos, q) {
  const words = [q.value, ...followersOf(q).map((w) => w.value)];
  if (pos === "phrase") return "Counts each distinct matched phrase, e.g. “you and me” vs “you and I”. With Ignore case, capitalisation is merged.";
  if (pos?.startsWith("word:")) {
    const n = Number(pos.slice(5));
    const w = followersOf(q)[n - 2];
    return `Counts word ${n} of each match (“${words[n - 1]}”).${w?.optional ? " It is optional: matches without it are counted under an empty value." : ""}`;
  }
  if (pos === "before") return "Counts the word immediately before each match.";
  if (pos === "after") return "Counts the word immediately after each match.";
  return "Counts the matched word itself.";
}

function Frequencies() {
  const { info, run, analysis, setAnalysis, toast, log, busy } = useApp();
  const b = useBase();
  const ci = b.base ? info?.corpora?.[b.base.corpus] : null;
  const opts = GROUPABLE.filter((f) => (f === "lexeme" ? ci?.lexeme : ci?.positional?.includes(f))).map((f) => [f, FIELD_LABELS[f] || f]);
  const posOpts = b.base ? positionOptions(b.base) : [];
  const [field, setField] = useState("word");
  const [position, setPosition] = useState("first");
  const [extra, setExtra] = useState([]); // [{ corpus, filters }]
  const [pick, setPick] = useState(null);
  const res = analysis.frequencies && b.key && analysis.frequencies.key === b.key ? analysis.frequencies : null;

  useEffect(() => {
    if (opts.length && !opts.some(([f]) => f === field)) setField(opts.find(([f]) => f === "word")?.[0] || opts[0][0]);
  }, [ci]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (posOpts.length && !posOpts.some(([v]) => v === position)) setPosition(posOpts[0][0]);
  }, [b.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b.base) return <BaseNotice b={b} />;
  const others = orderedCorpora(info).filter((c) => c !== b.base.corpus && isSearchable(info.corpora[c]));

  const go = async () => {
    const runs = [{ corpus: b.base.corpus, request: b.base, filters: describeFilters(b.base) }];
    for (const x of extra) {
      runs.push({ corpus: x.corpus, request: { ...b.base, corpus: x.corpus, meta_attr: "", meta_value: "", filters: x.filters }, filters: describeFilters({ filters: x.filters }) });
    }
    const results = [];
    const t0 = performance.now();
    for (const r of runs) {
      const out = await run(`Counting in ${r.corpus}`, "run_frequencies", { request: { ...r.request, group_field: field, group_position: position } }, { quiet: true })
        .catch((e) => ({ error: e?.message || String(e) }));
      if (out?.data) results.push({ corpus: r.corpus, filters: r.filters, data: out.data });
      else results.push({ corpus: r.corpus, filters: r.filters, error: out?.error || "Not counted" });
    }
    if (!results.some((r) => r.data)) return toast(results.map((r) => `${r.corpus}: ${r.error}`).join(" · "), "negative", 0);
    setPick(null);
    setAnalysis((a) => ({ ...a, frequencies: { key: b.key, field, position, results, elapsed: (performance.now() - t0) / 1000, corpus: b.base.corpus } }));
    log({ label: `Counted “${b.base.value}” by ${field} (${posOpts.find(([v]) => v === position)?.[1] || position})`, detail: `${results.length} corpus${results.length === 1 ? "" : "es"}` });
  };

  return (
    <div className="stack">
      <Card title="Count the matches by an annotation" sub="Counts the full result on the server, not just the page you viewed"
        actions={<Button variant="primary" icon={Play} onClick={go} disabled={!!busy}>Count</Button>}>
        <div className="stack" style={{ gap: 16 }}>
          <QuerySummary q={b.base} />
          <div className="form-grid">
            <Field label="Count" htmlFor="fq-pos">
              <Select id="fq-pos" value={position} options={posOpts} onChange={(e) => setPosition(e.target.value)} />
            </Field>
            <Field label="Grouped by" htmlFor="fq-field">
              <Select id="fq-field" value={field} options={opts} onChange={(e) => setField(e.target.value)} />
            </Field>
          </div>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{positionHint(position, b.base)}</div>
          <ExtraCorpora base={b.base.corpus} others={others} extra={extra} setExtra={setExtra} />
        </div>
      </Card>

      {res && (res.results ? <FrequencyResults res={res} pick={pick} setPick={setPick} toast={toast} log={log} /> : null)}
    </div>
  );
}

/** "Also count in": extra corpora, each with its own document filters. */
function ExtraCorpora({ base, others, extra, setExtra }) {
  const { info } = useApp();
  const has = (c) => extra.some((x) => x.corpus === c);
  return (
    <div className="stack" style={{ gap: 10, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
      <div className="section-label">Also count in</div>
      <div className="row" style={{ gap: 6 }} role="group" aria-label="Also count in">
        {others.map((c) => (
          <button key={c} type="button" className={`chip-toggle${has(c) ? " is-on" : ""}`} aria-pressed={has(c)} disabled={!has(c) && extra.length >= 5}
            onClick={() => setExtra((list) => (has(c) ? list.filter((x) => x.corpus !== c) : [...list, { corpus: c, filters: [] }]))}>
            <Flag variety={info.corpora[c].variety} note={info.corpora[c].variety_note} size={14} />{c}
          </button>
        ))}
      </div>
      {extra.map((x) => (
        <div key={x.corpus} className="stack" style={{ gap: 6, paddingLeft: 12, borderLeft: "2px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{x.corpus} — only in documents where</div>
          <FilterEditor corpus={x.corpus} filters={x.filters} idPrefix={`fx-${x.corpus}`} compact
            onChange={(list) => setExtra((all) => all.map((y) => (y.corpus === x.corpus ? { ...y, filters: list } : y)))} />
        </div>
      ))}
      {extra.length > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          The same search runs in each corpus; {base}'s filters come from the search. Shares are within each corpus, so corpora of different sizes compare directly.
        </div>
      )}
    </div>
  );
}

function FrequencyResults({ res, pick, setPick, toast, log }) {
  const ok = res.results.filter((r) => r.data);
  const multi = ok.length > 1;
  const lexical = ["word", "lexeme", "lemma", "hw"].includes(res.field) || res.position === "phrase";
  const showMeaning = !multi && !lexical;
  const posLabel = res.position === "phrase" ? "phrase" : res.position.startsWith("word:") ? `word ${res.position.slice(5)}` : res.position === "first" ? "matched word" : `word ${res.position} the match`;
  // Union of values across corpora, ordered by combined share.
  const rows = useMemo(() => {
    const map = new Map();
    ok.forEach((r, ci) => {
      const sum = r.data.groups.reduce((s, g) => s + g.count, 0) || 1;
      for (const g of r.data.groups) {
        const row = map.get(g.value) || { value: g.value, meaning: g.meaning, counts: ok.map(() => 0), shares: ok.map(() => 0) };
        row.counts[ci] = g.count;
        row.shares[ci] = g.count / sum;
        map.set(g.value, row);
      }
    });
    return [...map.values()].sort((a, b) => b.shares.reduce((s, x) => s + x, 0) - a.shares.reduce((s, x) => s + x, 0));
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxShare = Math.max(0.0001, ...rows.flatMap((r) => r.shares));
  const exportRows = rows.map((r) => Object.fromEntries([["value", r.value], ...ok.flatMap((c, i) => [[`${c.corpus}_count`, r.counts[i]], [`${c.corpus}_share`, Number((r.shares[i] * 100).toFixed(2))]])]));
  const first = ok[0];

  return (
    <div className={multi ? "stack" : "grid grid--split"} style={{ alignItems: "start" }}>
      <Card flush
        title={multi ? <>{ok.length} corpora · {thousands(rows.length)} distinct values</> : <><strong>{thousands(first.data.total)}</strong> matches · {thousands(rows.length)} distinct values</>}
        sub={`${res.field} of the ${posLabel} · ${seconds(res.elapsed)}${ok.some((r) => r.data.truncated) ? " · top 300 values per corpus" : ""}${ok.some((r) => r.data.counted != null && r.data.counted < r.data.total) ? " · phrases counted from the first 200,000 matches" : ""}`}
        actions={<Button icon={FileDown} onClick={async () => { const path = await saveDialog({ defaultPath: `${safeFileStem(res.corpus)}_counts.csv` }); if (path) exportReport(toast, log, "Exported counts", invoke("export_table", { path, rows: exportRows })); }}>Export…</Button>}>
        {rows.length ? (
          <div className="table-wrap table-scroll" style={{ "--table-max": "560px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Value</th>
                  {showMeaning && <th>Meaning</th>}
                  {ok.map((r) => (
                    <th key={r.corpus} className="num" colSpan={2} title={r.filters.length ? `Filtered: ${r.filters.join("; ")}` : "Whole corpus"}>
                      {r.corpus}{r.filters.length ? " ·  filtered" : ""}
                      <div className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>{thousands(r.data.total)} matches</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.value + i} data-clickable={!multi || undefined} aria-selected={pick === r.value} onClick={() => setPick(r.value)}>
                    <td className="mono">{r.value || <span className="muted">(none)</span>}</td>
                    {showMeaning && <td className="muted">{r.meaning}</td>}
                    {ok.map((c, j) => (
                      <FragmentCells key={c.corpus} count={r.counts[j]} share={r.shares[j]} max={maxShare} color={SERIES[j % SERIES.length]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No values">The search matched nothing, so there is nothing to count.</EmptyState>
        )}
      </Card>
      {!multi && (
        <div className="stack">
          {pick != null && !lexical ? (
            <ExplainPanel corpus={res.corpus} field={res.field} value={pick} onClose={() => setPick(null)} />
          ) : (
            <Card title="Reading this table">
              <div className="prose" style={{ fontSize: 13 }}>
                <p>Each row is a value of <strong>{res.field}</strong> for the {posLabel}, counted over all {thousands(first.data.total)} matches. The share is that value's part of all counted matches.</p>
                <p>Tags come from the corpus's automatic tagger. Select a row to see what a code means.</p>
              </div>
            </Card>
          )}
        </div>
      )}
      {res.results.some((r) => r.error) && (
        <Notice tone="warn">
          {res.results.filter((r) => r.error).map((r) => <div key={r.corpus}><strong>Not counted in {r.corpus}:</strong> {r.error}</div>)}
        </Notice>
      )}
    </div>
  );
}

function FragmentCells({ count, share, max, color }) {
  return (
    <>
      <td className="num">{count ? thousands(count) : <span className="muted">0</span>}</td>
      <td style={{ minWidth: 150 }}>
        <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <BarCell value={share} max={max} color={color} />
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", width: 48, textAlign: "right" }}>{(share * 100).toFixed(1)}%</span>
        </div>
      </td>
    </>
  );
}

function Collocates() {
  const { run, analysis, setAnalysis, toast, log, busy } = useApp();
  const b = useBase();
  const [sample, setSample] = useState(100);
  const res = analysis.collocates && b.key && analysis.collocates.key === b.key ? analysis.collocates : null;
  const rows = useMemo(() => collocationSeries(res?.data?.groups, 5).all, [res]);
  if (!b.base) return <BaseNotice b={b} />;

  const go = async () => {
    const r = await runCollocates({ run, query: b.base, sample, key: b.key });
    if (!r) return;
    setAnalysis((a) => ({ ...a, collocates: r }));
    log({ label: `Nearby words of “${b.base.value}”`, detail: `${r.data.groups.length} words · ${seconds(r.elapsed)}` });
  };
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="stack">
      <Card title="Which words appear nearby?" sub="Positional counts L4–R4 from the first N matches in corpus order"
        actions={<Button variant="primary" icon={Play} onClick={go} disabled={!!busy}>Count</Button>}>
        <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
          <QuerySummary q={b.base} />
          <span className="spacer" />
          <Field label="Matches to sample" htmlFor="col-n" hint="1–500, first in corpus order">
            <Input id="col-n" mono type="number" min={1} max={500} value={sample} onChange={(e) => setSample(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} style={{ width: 140 }} />
          </Field>
        </div>
      </Card>
      {res ? (
        <>
          <Card title={<><strong>{thousands(res.data.groups.length)}</strong> neighbouring words</>} sub={`${thousands(res.data.sampled)} of ${thousands(res.data.total)} matches sampled · ${seconds(res.elapsed)}`}>
            {rows.length ? <CollocationChart result={res.data} /> : <EmptyState title="No neighbours">The sample contained no context tokens.</EmptyState>}
          </Card>
          <Card flush title="All positions" actions={<Button icon={FileDown} onClick={async () => { const path = await saveDialog({ defaultPath: `${safeFileStem(b.base.corpus)}_collocates.csv` }); if (path) exportReport(toast, log, "Exported neighbouring words", invoke("export_table", { path, rows: res.data.groups })); }}>Export…</Button>}>
            <div className="table-wrap" style={{ "--table-max": "480px", borderTop: "1px solid var(--border-subtle)" }}>
              <table className="table">
                <thead><tr><th>Word</th><th style={{ width: "18%" }}>Total</th>{POSITIONS.map((p) => <th key={p} className="num">{p}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.word + i}>
                      <td>{r.word}</td>
                      <td><BarCell value={r.total} max={max} color={i < 5 ? SERIES[i] : "var(--chart-neutral)"} /></td>
                      {r.values.map((v, j) => <td key={j} className="num" style={{ color: v ? "var(--text-1)" : "var(--text-4)" }}>{v}</td>)}
                      <td className="num">{thousands(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card><EmptyState icon={Sparkles} title="Not counted yet">Press Count to run the university's collocates script on the first {sample} matches. These are raw positional counts — not MI, t-score or log-likelihood.</EmptyState></Card>
      )}
    </div>
  );
}

/** Standard Brown-family text categories (Brown, LOB, FLOB, Frown). */
const BROWN_CATEGORIES = {
  A: "Press: reportage", B: "Press: editorial", C: "Press: reviews", D: "Religion", E: "Skills, trades, hobbies",
  F: "Popular lore", G: "Belles lettres, biography", H: "Miscellaneous (official)", J: "Learned & scientific",
  K: "General fiction", L: "Mystery & detective", M: "Science fiction", N: "Adventure & western", P: "Romance", R: "Humour",
};
const brownCode = (v) => /(?:^|[^A-Za-z])([A-HJ-NPR])\d{2}/.exec(String(v))?.[1] || null;

/** Roll file ids up into Brown genre categories (sums matches and sizes). */
export function byBrownCategory(rows) {
  const acc = new Map();
  for (const r of rows) {
    const c = brownCode(r.value);
    const key = c ? `${c} · ${BROWN_CATEGORIES[c]}` : "other";
    const a = acc.get(key) || { value: key, hits: 0, tokens: 0, regions: 0 };
    a.hits += r.hits; a.tokens += r.tokens; a.regions += r.regions;
    acc.set(key, a);
  }
  return [...acc.values()].map((a) => ({ ...a, per_million: a.tokens ? Math.round((a.hits * 1e6 / a.tokens) * 100) / 100 : 0 }));
}

function Distribution() {
  const { info, run, analysis, setAnalysis, toast, log, busy } = useApp();
  const b = useBase();
  const ci = b.base ? info?.corpora?.[b.base.corpus] : null;
  // Only attributes small enough to decode on the shared server (≤ 10,000 regions).
  const attrs = (ci?.metadata || []).filter((m) => (ci.structural?.[m] || 0) > 0 && ci.structural[m] <= 10000);
  const [attr, setAttr] = useState("");
  const [order, setOrder] = useState("rate");
  const [minTokens, setMinTokens] = useState(10000);
  const [byGenre, setByGenre] = useState(true);
  useEffect(() => {
    if (!attrs.includes(attr)) setAttr(attrs.find((a) => /genre|type|decade|period|sex|age|class/i.test(a)) || attrs[0] || "");
  }, [ci]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = analysis.distribution && b.key && analysis.distribution.key === b.key ? analysis.distribution : null;
  if (!b.base) return <BaseNotice b={b} />;

  const go = async () => {
    const out = await run(`Counting matches across ${attr}`, "run_distribution", { request: { ...b.base, attribute: attr } });
    if (!out) return;
    setAnalysis((a) => ({ ...a, distribution: { key: b.key, attr, data: out.data, elapsed: out.elapsed_seconds, corpus: b.base.corpus } }));
    log({ label: `Distribution of “${b.base.value}” across ${attr}`, detail: `${out.data.rows.length} values · ${seconds(out.elapsed_seconds)}` });
  };
  const raw = res?.data?.rows || [];
  const brownLike = raw.length > 0 && raw.filter((r) => brownCode(r.value)).length / raw.length >= 0.8;
  const all = brownLike && byGenre ? byBrownCategory(raw) : raw;
  const rows = [...all].sort((x, y) => (order === "rate" ? y.per_million - x.per_million : order === "hits" ? y.hits - x.hits : String(x.value).localeCompare(String(y.value), undefined, { numeric: true })));
  const reliable = rows.filter((r) => r.tokens >= minTokens);
  const max = Math.max(1e-9, ...reliable.map((r) => r.per_million));
  const covered = all.filter((r) => r.hits > 0).length;
  const filtered = describeFilters(b.base).length > 0;

  return (
    <div className="stack">
      <Card title="Break matches down by metadata" sub="Matches per value, divided by that value's own size"
        actions={<Button variant="primary" icon={Play} onClick={go} disabled={!!busy || !attr}>Count</Button>}>
        <div className="stack" style={{ gap: 16 }}>
          <QuerySummary q={b.base} />
          {attrs.length ? (
            <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
              <Field label="Across" htmlFor="ds-attr" style={{ minWidth: 220 }}>
                <Select id="ds-attr" value={attr} options={attrs.map((a) => [a, `${a} · ${thousands(ci.structural[a])} regions`])} onChange={(e) => setAttr(e.target.value)} />
              </Field>
              <Field label="Hide rates for values smaller than" htmlFor="ds-min" hint="tokens — tiny groups give unstable rates">
                <Select id="ds-min" value={minTokens} options={[[0, "show all"], [1000, "1,000"], [10000, "10,000"], [50000, "50,000"]]} onChange={(e) => setMinTokens(Number(e.target.value))} />
              </Field>
            </div>
          ) : (
            <Notice tone="warn">{b.base.corpus} has no metadata attribute small enough to break results down by on the shared server.</Notice>
          )}
        </div>
      </Card>
      {res && filtered && (
        <Notice tone={res.data.sizes_filtered ? "info" : "warn"}>
          {res.data.sizes_filtered
            ? "Group sizes count only the documents that pass the search's filters, so each rate is per million tokens of the filtered part."
            : "The search's filters use attributes divided into different regions than this one, so group sizes include unfiltered documents and the rates are too low. Break down by an attribute on the same level as the filters (for example text attributes with text filters)."}
        </Notice>
      )}
      {res && (
        <Card flush title={<><strong>{thousands(res.data.total)}</strong> matches across {thousands(all.length)} {brownLike && byGenre ? "genre categories" : `values of ${res.attr}`}</>}
          sub={`${covered} values contain at least one match · ${seconds(res.elapsed)}${res.data.counted < res.data.total ? ` · first ${thousands(res.data.counted)} matches assigned` : ""}${res.data.truncated ? " · top 1,000 values" : ""}`}
          actions={
            <>
              {brownLike && <Checkbox label="Group by genre category (A–R)" checked={byGenre} onChange={setByGenre} title="Brown-family file ids start with their category letter" />}
              <Segmented small value={order} onChange={setOrder} label="Order" options={[["rate", "Per million"], ["hits", "Matches"], ["value", "A–Z"]]} />
              <Button icon={FileDown} onClick={async () => { const path = await saveDialog({ defaultPath: `${safeFileStem(res.corpus)}_${res.attr}_distribution.csv` }); if (path) exportReport(toast, log, "Exported distribution", invoke("export_table", { path, rows, columns: ["value", "hits", "tokens", "regions", "per_million"] })); }}>Export…</Button>
            </>
          }>
          <div className="table-wrap" style={{ "--table-max": "560px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <thead><tr><th>{brownLike && byGenre ? "Genre category" : res.attr}</th><th className="num">Matches</th><th className="num">Tokens in group</th><th style={{ width: "28%" }}>Rate</th><th className="num">Per million</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const small = r.tokens < minTokens;
                  return (
                    <tr key={r.value + i} style={small ? { opacity: 0.5 } : undefined} title={small ? "Group too small for a stable rate" : ""}>
                      <td className="mono">{r.value || "(empty)"}</td>
                      <td className="num">{thousands(r.hits)}</td>
                      <td className="num">{r.tokens ? thousands(r.tokens) : "—"}</td>
                      <td>{small ? <span className="muted" style={{ fontSize: 12 }}>small group</span> : <BarCell value={r.per_million} max={max} color={SERIES[0]} />}</td>
                      <td className="num">{r.tokens ? r.per_million.toFixed(2) : "—"}</td>
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

function Codes() {
  const { info, query, run, analysis, setAnalysis, busy } = useApp();
  const [corpus, setCorpus] = useState(query.corpus);
  const ci = info?.corpora?.[corpus];
  const opts = ["pos", "class", "rel", "usas"].filter((f) => ci?.positional?.includes(f)).map((f) => [f, FIELD_LABELS[f]]);
  const [field, setField] = useState("pos");
  const [glossary, setGlossary] = useState([]);
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState(null);
  const res = analysis.lexicon && analysis.lexicon.corpus === corpus && analysis.lexicon.field === field ? analysis.lexicon : null;

  useEffect(() => {
    invoke("get_glossary", { corpus }).then(setGlossary).catch(() => setGlossary([]));
    if (!opts.some(([f]) => f === field)) setField(opts[0]?.[0] || "pos");
  }, [corpus]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    const out = await run("Loading tag inventory", "run_lexicon", { request: { corpus, field } });
    if (out) setAnalysis((a) => ({ ...a, lexicon: { corpus, field, data: out.data, elapsed: out.elapsed_seconds } }));
  };
  const f = filter.trim().toLowerCase();
  const gl = glossary.filter((g) => !f || `${g.code} ${g.label} ${g.category}`.toLowerCase().includes(f));
  const max = Math.max(1, ...(res?.data.groups || []).map((g) => g.count));

  return (
    <div className="grid grid--split" style={{ alignItems: "start" }}>
      <div className="stack">
        <Card title="Codes used in this corpus" sub="Every value of the attribute with its corpus frequency (server)"
          actions={<Button variant="primary" icon={Play} onClick={go} disabled={!!busy || !opts.length}>Load</Button>}>
          <div className="row" style={{ gap: 16 }}>
            <Field label="Corpus" htmlFor="cd-c" style={{ minWidth: 200 }}>
              <Select id="cd-c" value={corpus} options={Object.keys(info?.corpora || {}).map((c) => [c, c])} onChange={(e) => { setCorpus(e.target.value); setPick(null); }} />
            </Field>
            <Field label="Attribute" htmlFor="cd-f" style={{ minWidth: 200 }}>
              <Select id="cd-f" value={field} options={opts.length ? opts : [["pos", "No tag attributes"]]} onChange={(e) => setField(e.target.value)} />
            </Field>
          </div>
        </Card>
        {res && (
          <Card flush title={<><strong>{thousands(res.data.groups.length)}</strong> codes</>} sub={`${corpus} · ${field}${res.data.truncated ? " · first 2,500" : ""}`}>
            <div className="table-wrap" style={{ "--table-max": "520px", borderTop: "1px solid var(--border-subtle)" }}>
              <table className="table">
                <thead><tr><th>Code</th><th>Meaning</th><th style={{ width: "22%" }} /><th className="num">Tokens</th></tr></thead>
                <tbody>
                  {res.data.groups.map((g, i) => (
                    <tr key={g.value + i} data-clickable="true" aria-selected={pick === g.value} onClick={() => setPick(g.value)}>
                      <td className="mono">{g.value}</td><td className="muted">{g.meaning}</td><td><BarCell value={g.count} max={max} color={corpusColor(corpus)} /></td><td className="num">{thousands(g.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
      <div className="stack">
        {pick && <ExplainPanel corpus={corpus} field={field} value={pick} onClose={() => setPick(null)} />}
        <Card flush title="Codebook" sub={`Packaged glossary for ${corpus} · works offline`}>
          <div style={{ padding: "0 24px 12px" }}>
            <label className="sr-only" htmlFor="gl-q">Filter codebook</label>
            <div style={{ position: "relative" }}>
              <SearchIcon {...ICON} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-3)" }} aria-hidden="true" />
              <Input id="gl-q" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter codes, e.g. VVG or adjective" style={{ paddingLeft: 36 }} />
            </div>
          </div>
          <div className="table-wrap" style={{ "--table-max": "560px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <tbody>
                {gl.slice(0, 400).map((g, i) => (
                  <tr key={g.category + g.code + i} data-clickable={g.category === "POS"} onClick={() => g.category === "POS" && (setField("pos"), setPick(g.code))} title={g.note}>
                    <td className="mono" style={{ width: 90 }}>{g.code}</td>
                    <td>{g.label}</td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 12, textAlign: "right" }}>{g.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!gl.length && <EmptyState icon={BookOpen} title="No codes match">Try a shorter filter.</EmptyState>}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function Analysis({ sub }) {
  return (
    <div className="page">
      <PageHeader aside={sub === "tags" ? "codebook" : null} />
      {sub === "nearby" ? <Collocates /> : sub === "tags" ? <Codes /> : sub === "spread" ? <Distribution /> : <Frequencies />}
    </div>
  );
}
