import { SEARCH_VIEWS, isSearchable, varietyInfo } from "../nav.js";
import { PageHeader } from "../components/PageHeader.jsx";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookmarkPlus, ChartLine, ChevronLeft, ChevronRight, Copy, Download, FileDown, Maximize2, Minimize2, Network, NotebookPen, Play, RotateCcw, TextSearch, Quote } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { exportReport } from "../lib/exportReport.js";
import { invoke, saveDialog } from "../lib/ipc.js";
import { Button, Card, Dialog, EmptyState, Field, Input, Notice, Select, Spinner, ViewTabs } from "../components/ui.jsx";
import { useUiState } from "../lib/uiState.js";
import { QueryBuilder, useCqpPreview } from "../components/QueryBuilder.jsx";
import { QueryPanel } from "../components/TerminalBlock.jsx";
import { Kwic } from "../components/Kwic.jsx";
import { safeFileStem, seconds, thousands } from "../lib/format.js";
import { hasQuery, queryLabel } from "../lib/query.js";
import { Rate, Size, UnitLabel } from "../components/Units.jsx";

const named = (k) => lazy(() => import("../views/Analyses.jsx").then((m) => ({ default: m[k] })));
const VIEWS = {
  counts: named("CountsView"),
  nearby: named("NearbyView"),
  spread: named("SpreadView"),
  compare: lazy(() => import("../views/Compare.jsx").then((m) => ({ default: m.CompareView }))),
  structure: lazy(() => import("../views/Structure.jsx").then((m) => ({ default: m.StructureView }))),
};

/**
 * The Search workspace: the query panel on the left, the result bar and the
 * result views (Matches, Counts, Nearby, Spread, Compare, Structure) on the
 * right. Every view keeps its last result for the current search.
 */
export default function Search() {
  const { query, setQuery, search, setSearch, run, toast, log, remember, info, screen, setScreen, evidence, setEvidence, setEvidenceDirty, prefs, setPrefs, busy, analysis, setAnalysis } = useApp();
  const view = screen.split("/")[1] || "matches";
  const [limit, setLimit] = useUiState("matches.limit", 25);
  const [context, setContext] = useUiState("matches.context", 4);
  const [sort, setSort] = useUiState("matches.sort", "");
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const nameTaken = !!saveName.trim() && (prefs?.saved_searches || []).some((x) => x.name === saveName.trim());
  const [confirmAll, setConfirmAll] = useState(false);
  const { preview, error } = useCqpPreview(query);
  const keyRef = useRef(queryKey(query));
  const resultsRef = useRef(null);
  const pendingScroll = useRef(false);
  // After "Go to match", centre the chosen line (runs after Kwic's own "nearest" scroll).
  const jumped = useRef(null);
  useEffect(() => {
    if (jumped.current == null || selected !== jumped.current) return;
    jumped.current = null;
    pendingScroll.current = false;
    document.querySelector(`.kwic__row[data-i="${selected}"]`)?.scrollIntoView({ block: "center" });
  }, [selected, search]);
  // Bring fresh results into view; the form stays one scroll up.
  useEffect(() => {
    if (!pendingScroll.current || !resultsRef.current) return;
    pendingScroll.current = false;
    const el = resultsRef.current;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.6 || r.top < 0) {
      el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [search]);
  keyRef.current = queryKey(query);

  const ci = info?.corpora?.[query.corpus];
  const unqueryable = !!ci && !isSearchable(ci);
  const stale = search && search.key !== queryKey(query);
  const data = search?.data;

  const execute = async (offset = 0, opts = {}) => {
    const key = queryKey(query);
    const request = { ...query, gap: Number(query.gap || 0), offset, limit: opts.limit ?? limit, context: opts.context ?? context, sort: opts.sort ?? sort };
    const out = await run(`Searching ${query.corpus}`, "run_search", { request }, { retry: () => execute(offset, opts) });
    if (!out) return;
    if (keyRef.current !== key) {
      toast("The query changed while this search ran, so its result was discarded.", "warning");
      return;
    }
    const interpretation = await invoke("interpret_search", { query, total: out.data.total }).catch(() => null);
    setSelected(opts.select ?? null);
    setSearch({ key, request, data: out.data, elapsed: out.elapsed_seconds, cached: out.cached, interpretation });
    if (offset === 0) remember(query, out.data.total);
    pendingScroll.current = true; // scrolled once the results have rendered (effect below)
    if (offset === 0) log({ label: `${query.corpus} · ${queryLabel(query)}`, detail: `${thousands(out.data.total)} in ${seconds(out.elapsed_seconds)}` });
  };

  useEffect(() => {
    const onSearch = () => !busy && hasQuery(query) && !unqueryable && execute(0);
    const onSave = () => hasQuery(query) && setSaveOpen(true);
    const onExport = () => data && !stale && exportPage();
    const onPage = (e) => {
      if (!data || stale || busy) return;
      const next = page.offset + e.detail * page.limit;
      if (next >= 0 && next < data.total) execute(next);
    };
    const onEvidence = () => data && !stale && data.results.length && addEvidence();
    const on = { "cqp:search": onSearch, "cqp:save": onSave, "cqp:export": onExport, "hapax:page": onPage, "hapax:add-evidence": onEvidence };
    Object.entries(on).forEach(([k, f]) => window.addEventListener(k, f));
    return () => Object.entries(on).forEach(([k, f]) => window.removeEventListener(k, f));
  });

  const exportPage = async () => {
    const path = await saveDialog({ defaultPath: `${safeFileStem(search.request.corpus)}_concordance_page.csv` });
    if (!path) return;
    exportReport(toast, log, "Exported concordance page", invoke("export_concordance_page", { path, request: search.request, rows: data.results, total: data.total }));
  };

  const exportAll = async () => {
    setConfirmAll(false);
    const path = await saveDialog({ defaultPath: `${safeFileStem(search.request.corpus)}_concordances.csv` });
    if (!path) return;
    exportReport(toast, log, "Exported first 5,000 matches", run("Exporting up to 5,000 matches", "export_search_all", { path, request: search.request }));
  };

  const copyPage = () => {
    const lines = data.results.map((r, i) => [page.offset + i + 1, r.left, r.text, r.right, r.source || ""].join("\t"));
    const head = `# ${search.request.corpus} · ${thousands(data.total)} matches · rows ${thousands(from)}–${thousands(to)}${page.sort ? ` · sorted by ${page.sort}` : ""}\n#\tleft\tmatch\tright\tsource`;
    navigator.clipboard?.writeText(`${head}\n${lines.join("\n")}\n`).then(() => toast(`Copied ${lines.length} lines`, "neutral", 2500));
  };

  const addEvidence = async () => {
    try {
      const r = await invoke("evidence_add", { notebook: evidence, corpus: search.request.corpus, rows: data.results, query: search.request });
      setEvidence(r.rows);
      setEvidenceDirty(true);
      toast(`Added ${r.added} new example${r.added === 1 ? "" : "s"} to the evidence notebook.`, "positive");
    } catch (e) {
      toast(e.message, "negative");
    }
  };

  const doSave = async () => {
    try {
      const list = await invoke("save_search", { name: saveName, query });
      setPrefs((p) => ({ ...p, saved_searches: list }));
      toast(`Saved search “${saveName}” on this computer.`, "positive");
      setSaveOpen(false);
    } catch (e) {
      toast(e.message, "warning");
    }
  };

  const sel = selected != null ? data?.results?.[selected] : null;
  const page = search?.request;
  const from = page ? page.offset + 1 : 0;
  const to = page ? page.offset + (data?.results?.length || 0) : 0;

  const showStructure = query.corpus === "EFCAM" || search?.request?.corpus === "EFCAM" || !!analysis.structure || view === "structure";
  const views = SEARCH_VIEWS.filter((v) => v.id !== "structure" || showStructure);
  const View = VIEWS[view];
  const inspectSyntax = (start) => { setAnalysis((a) => ({ ...a, syntaxAt: start })); setScreen("search/structure"); };

  return (
    <div className="page page--wide">
      <PageHeader aside={ci ? <span title={`${ci.variety_note || varietyInfo(ci.variety).label} — ${ci.description}`}>{query.corpus} · <Size corpus={query.corpus} /></span> : query.corpus} />

      <div className={`workspace${focus ? " is-focus" : ""}`}>
      {!focus && (
        <aside className="workspace__query" aria-label="Query">
        <Card
          title="Query"
          actions={
            <>
              <Button icon={BookmarkPlus} onClick={() => { setSaveName(`${query.corpus} — ${queryLabel(query)}`); setSaveOpen(true); }} disabled={!hasQuery(query) || !!error} title="Save this search (Ctrl+S)">Save</Button>
              <Button variant="primary" icon={Play} onClick={() => execute(0)} disabled={!hasQuery(query) || !!error || !!busy || unqueryable} title={unqueryable ? "This corpus cannot be queried on this server" : "Search (Ctrl+Enter)"}>Search</Button>
            </>
          }
        >
          <div className="stack" style={{ gap: 16 }}>
            {unqueryable && ci.available === false && (
              <Notice tone="warn">
                <strong>{query.corpus} is not on the server right now.</strong> It was missing from the corpus registry when you
                connected. Choose another corpus, or use Check again under Corpora later.
              </Notice>
            )}
            {unqueryable && ci.available !== false && (
              <Notice tone="warn">
                <strong>{query.corpus} can't be searched on this server.</strong> Its registry declares a character encoding that
                CWB doesn't recognise, so CQP rejects every query on it (“unrecognised CorpusCharset”). This is a server
                configuration issue, not your query. You can still look up its tags and metadata under Corpora.
              </Notice>
            )}
            <QueryBuilder query={query} onChange={setQuery} onSubmit={() => !error && hasQuery(query) && execute(0)} allowCqp errorId={error ? "query-error" : null} />
            <QueryPanel preview={preview} error={error} op="search"
              request={unqueryable ? null : { ...query, gap: Number(query.gap || 0), offset: 0, limit, context }} />
          </div>
        </Card>
        </aside>
      )}
      <section className="workspace__results" aria-label="Results">
        <div className="result-bar" ref={resultsRef}>
          <div className="result-bar__status" role="status" aria-live="polite">
            {data ? (
              <>
                <span className="result-bar__total">{thousands(data.total)}</span>
                <span>{data.total === 1 ? "match" : "matches"}</span>
                <span className="result-bar__sep" aria-hidden="true">·</span>
                <span><span className="pos"><Rate count={data.total} corpus={search.request.corpus} /></span> <UnitLabel corpora={[search.request.corpus]} /></span>
                <span className="result-bar__sep" aria-hidden="true">·</span>
                <span className="mono muted" title="Client wall-clock time: SSH, remote CQP and parsing">{seconds(search.elapsed)}{search.cached ? " cached" : ""}</span>
                {search.request.corpus !== query.corpus && <span className="muted">· in {search.request.corpus}</span>}
              </>
            ) : (
              <span className="muted">No search run yet — press Search or Ctrl+Enter</span>
            )}
          </div>
          {stale && (
            <div className="result-bar__stale">
              <span>The query changed since these results.</span>
              <Button variant="ghost" icon={RotateCcw} onClick={() => execute(0)} disabled={!hasQuery(query) || !!error || !!busy || unqueryable}>Run again</Button>
            </div>
          )}
          <span className="spacer" />
          <Button variant="ghost" icon={focus ? Minimize2 : Maximize2} onClick={() => setFocus((f) => !f)} aria-pressed={focus} title="Hide or show the query panel">{focus ? "Show query" : "Focus results"}</Button>
        </div>
        <ViewTabs base="search" views={views} current={view} onChange={setScreen} label="Result views" />
        <div role="tabpanel" id={`panel-search-${view}`} aria-labelledby={`tab-search-${view}`} className="workspace__view">
          {view === "matches" ? (
            renderMatches()
          ) : View ? (
            <Suspense fallback={<Card><Spinner label="Loading view" /></Card>}><View /></Suspense>
          ) : null}
        </div>
      </section>
      </div>

      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} title="Save search definition" text="Saved locally in preferences.json. Results are not stored — the query runs again when restored."
        footer={<><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" onClick={doSave} disabled={!saveName.trim()}>{nameTaken ? "Replace" : "Save"}</Button></>}>
        <div className="dialog__body">
          <Field label="Name" htmlFor="save-name">
            <Input id="save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={200} onKeyDown={(e) => e.key === "Enter" && saveName.trim() && doSave()}
              aria-describedby={nameTaken ? "save-name-taken" : undefined} />
          </Field>
          {nameTaken && (
            <div id="save-name-taken" style={{ marginTop: 10 }}>
              <Notice tone="warn">A saved search called “{saveName.trim()}” already exists. Saving replaces it; choose another name to keep both.</Notice>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} title="Export the first 5,000 matches?"
        text={`There are ${thousands(data?.total || 0)} matches. To protect the shared server this exports only the first 5,000 (in the current sort order); the provenance file records that the export is partial.`}
        footer={<><Button onClick={() => setConfirmAll(false)}>Cancel</Button><Button variant="primary" onClick={exportAll}>Choose file…</Button></>} />
    </div>
  );

  /** Matches view: the concordance page with its controls, and the selected line. */
  function renderMatches() {
    if (!data) {
      return (
        <Card>
          <EmptyState icon={TextSearch} title="No matches yet">
            Write the search in the panel and press <strong>Search</strong> (Ctrl+Enter). Values are matched exactly; * stands for any ending (walk*, VV*), | or / separates alternatives. Leave the value empty and add a filter to list every word of those documents, or use Ask a question / Write CQP. Counts refer to the whole corpus; the list shows one page at a time.
          </EmptyState>
        </Card>
      );
    }
    return (
      <div className="stack">
        <Card flush style={stale ? { opacity: 0.55 } : undefined}>
          <div className="card__head card__head--pad view-controls">
            <div className="row" style={{ gap: 8 }}>
              <Select small aria-label="Sort order" title="Sorted on the server, so paging and exports follow this order" value={sort}
                options={[["", "Corpus order"], ["match", "Sort: match A–Z"], ["left", "Sort: word before"], ["right", "Sort: word after"]]}
                onChange={(e) => { const v = e.target.value; setSort(v); !stale && execute(0, { sort: v }); }} style={{ width: 160 }} />
              <Select small aria-label="Rows per page" value={limit} options={[[25, "25 / page"], [50, "50 / page"], [100, "100 / page"]]} onChange={(e) => { const v = Number(e.target.value); setLimit(v); !stale && execute(0, { limit: v }); }} style={{ width: 118 }} />
              <Select small aria-label="Context words" value={context} options={[[2, "± 2 words"], [4, "± 4 words"], [6, "± 6 words"], [10, "± 10 words"]]} onChange={(e) => { const v = Number(e.target.value); setContext(v); !stale && execute(page.offset, { context: v }); }} style={{ width: 120 }} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              {data.total > 0 && <span className="mono muted" style={{ fontSize: "var(--fs-mono)" }}>{thousands(from)}–{thousands(to)} of {thousands(data.total)}</span>}
              <Button icon={ChevronLeft} aria-label="Previous page" title="Previous page (Alt+←)" disabled={stale || page.offset === 0 || !!busy} onClick={() => execute(Math.max(0, page.offset - page.limit))} />
              <Button icon={ChevronRight} aria-label="Next page" title="Next page (Alt+→)" disabled={stale || to >= data.total || !!busy} onClick={() => execute(page.offset + page.limit)} />
              {data.total > page.limit && (
                <GoToMatch total={data.total} disabled={stale || !!busy}
                  onGo={(n) => {
                    const off = Math.floor((n - 1) / page.limit) * page.limit;
                    jumped.current = n - 1 - off;
                    if (off === page.offset) setSelected(n - 1 - off);
                    else execute(off, { select: n - 1 - off });
                  }} />
              )}
            </div>
          </div>
          {search.interpretation && (
            <div style={{ padding: "0 24px 14px", color: "var(--text-2)", fontSize: "var(--fs-small)", maxWidth: "110ch" }}>{search.interpretation}</div>
          )}
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {data.results.length ? (
              <Kwic rows={data.results} offset={page.offset} selected={selected} onSelect={setSelected} />
            ) : (
              <EmptyState icon={TextSearch} title="No matches">Check spelling and case, try “All forms (lexeme)”, or remove a filter. Zero is a valid, reportable result.</EmptyState>
            )}
          </div>
          <div className="card__foot" style={{ padding: "14px 24px", marginTop: 0 }}>
            <Button icon={FileDown} onClick={exportPage} disabled={stale || !data.results.length} title="Export this page (Ctrl+E)">Export page…</Button>
            <Button icon={Download} onClick={() => (data.total > 5000 ? setConfirmAll(true) : exportAll())} disabled={stale || !data.total || !!busy}>Export up to 5,000…</Button>
            <Button icon={Copy} onClick={copyPage} disabled={stale || !data.results.length} title="Copy this page as tab-separated text (paste into a spreadsheet or document)">Copy page</Button>
            <Button icon={NotebookPen} onClick={addEvidence} disabled={stale || !data.results.length} title="Add this page to the evidence notebook (Ctrl+Shift+E)">Add page to evidence</Button>
            <span className="spacer" />
            <Button variant="ghost" icon={ChartLine} onClick={() => setScreen("search/counts")} disabled={stale || !data.total} title="Counts view (Ctrl+2)">Count these matches</Button>
          </div>
        </Card>

        {sel && (
          <Card title="Selected match" sub={`${search.request.corpus} · tokens ${thousands(sel.start)}–${thousands(sel.end)}${sel.source ? ` · source ${sel.source}` : ""}`}
            actions={
              <>
                <Button variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(`${sel.left} [${sel.text}] ${sel.right}`).then(() => toast("Copied line", "neutral"))}>Copy</Button>
                <Button variant="ghost" icon={Quote} title="Copy as a citation line with corpus, source and token position" onClick={() => navigator.clipboard?.writeText(`“…${sel.left} ${sel.text} ${sel.right}…” (${search.request.corpus}${sel.source ? `, ${sel.source}` : ""}, token ${sel.start})`).then(() => toast("Copied citation", "neutral"))}>Cite</Button>
                {search.request.corpus === "EFCAM" && (
                  <Button variant="ghost" icon={Network} onClick={() => inspectSyntax(sel.start)}>Inspect syntax</Button>
                )}
              </>
            }
          >
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-2)" }}>
              {sel.left} <mark className="kwic__match">{sel.text}</mark> {sel.right}
            </p>
          </Card>
        )}
      </div>
    );
  }
}

/** Jump to the page holding match N and select that line. */
function GoToMatch({ total, disabled, onGo }) {
  const [v, setV] = useState("");
  const n = Number(v);
  const valid = Number.isInteger(n) && n >= 1 && n <= total;
  const go = () => { if (valid && !disabled) { onGo(n); setV(""); } };
  return (
    <div className="goto" title={`Show match 1–${thousands(total)} and select it`}>
      <label className="sr-only" htmlFor="goto-match">Go to match number</label>
      <input id="goto-match" className="input input--sm mono goto__input" inputMode="numeric" placeholder="Go to #" autoComplete="off"
        value={v} disabled={disabled} aria-invalid={v !== "" && !valid ? true : undefined}
        onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(); } }} />
      <Button disabled={!valid || disabled} onClick={go}>Go</Button>
    </div>
  );
}
