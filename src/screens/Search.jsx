import { isSearchable } from "../nav.js";
import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus, ChartLine, ChevronLeft, ChevronRight, Copy, Download, FileDown, Maximize2, Minimize2, Network, NotebookPen, Play, RotateCcw, TextSearch, Quote } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { invoke, saveDialog } from "../lib/ipc.js";
import { Button, Card, Dialog, EmptyState, Field, ICON, Input, Notice, Select } from "../components/ui.jsx";
import { QueryBuilder, CqpPreview, useCqpPreview } from "../components/QueryBuilder.jsx";
import { TerminalBlock } from "../components/TerminalBlock.jsx";
import { Kwic } from "../components/Kwic.jsx";
import { perMillion, rate, safeFileStem, seconds, thousands } from "../lib/format.js";

export async function exportReport(toast, log, label, promise) {
  try {
    const r = await promise;
    if (!r) return;
    const msg = typeof r === "string" ? `Saved ${r}` : `Saved ${thousands(r.rows)} rows${r.total != null ? ` of ${thousands(r.total)}` : ""} · ${r.path}${r.provenance_path ? " (+ provenance)" : ""}`;
    toast(msg, "positive", 7000);
    log?.({ label, detail: typeof r === "string" ? "saved" : `${thousands(r.rows)} rows` });
  } catch (e) {
    toast(e.message, "negative", 9000);
  }
}

export default function Search() {
  const { query, setQuery, search, setSearch, run, toast, log, remember, info, setScreen, evidence, setEvidence, setEvidenceDirty, prefs, setPrefs, busy } = useApp();
  const [limit, setLimit] = useState(search?.request?.limit || 25);
  const [context, setContext] = useState(search?.request?.context || 4);
  const [sort, setSort] = useState(search?.request?.sort || "");
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const { preview, error } = useCqpPreview(query);
  const keyRef = useRef(queryKey(query));
  const resultsRef = useRef(null);
  const pendingScroll = useRef(false);
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
    const out = await run(`Searching ${query.corpus}`, "run_search", { request });
    if (!out) return;
    if (keyRef.current !== key) {
      toast("The query changed while this search ran, so its result was discarded.", "warning");
      return;
    }
    const interpretation = await invoke("interpret_search", { query, total: out.data.total }).catch(() => null);
    setSelected(null);
    setSearch({ key, request, data: out.data, elapsed: out.elapsed_seconds, cached: out.cached, interpretation });
    if (offset === 0) remember(query, out.data.total);
    pendingScroll.current = true; // scrolled once the results have rendered (effect below)
    if (offset === 0) log({ label: `${query.corpus} · ${request.field} “${request.value}”`, detail: `${thousands(out.data.total)} in ${seconds(out.elapsed_seconds)}` });
  };

  useEffect(() => {
    const onSearch = () => !busy && query.value && !unqueryable && execute(0);
    const onSave = () => query.value && setSaveOpen(true);
    const onExport = () => data && !stale && exportPage();
    window.addEventListener("cqp:search", onSearch);
    window.addEventListener("cqp:save", onSave);
    window.addEventListener("cqp:export", onExport);
    return () => {
      window.removeEventListener("cqp:search", onSearch);
      window.removeEventListener("cqp:save", onSave);
      window.removeEventListener("cqp:export", onExport);
    };
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

  return (
    <div className="page">
      <PageHeader aside={query.corpus} />

      {!focus && (
        <Card
          title="What do you want to find?"
          sub={ci ? `${ci.description} · ${thousands(ci.tokens)} indexed tokens` : null}
          style={{ marginBottom: 16 }}
          actions={
            <>
              <Button icon={BookmarkPlus} onClick={() => { setSaveName(`${query.corpus} — ${query.value}`); setSaveOpen(true); }} disabled={!query.value || !!error}>Save</Button>
              <Button variant="primary" icon={Play} onClick={() => execute(0)} disabled={!query.value || !!error || !!busy || unqueryable} title={unqueryable ? "This corpus cannot be queried on this server" : "Search (Ctrl+Enter)"}>Search</Button>
            </>
          }
        >
          <div className="stack" style={{ gap: 20 }}>
            {unqueryable && ci.available === false && (
              <Notice tone="warn">
                <strong>{query.corpus} is not on the server right now.</strong> It was missing from the corpus registry when you
                connected. Choose another corpus, or use Check again under Corpora → Contents &amp; metadata later.
              </Notice>
            )}
            {unqueryable && ci.available !== false && (
              <Notice tone="warn">
                <strong>{query.corpus} can't be searched on this server.</strong> Its registry declares a character encoding that
                CWB doesn't recognise, so CQP rejects every query on it (“unrecognised CorpusCharset”). This is a server
                configuration issue, not your query. You can still look up its tags under Corpora → Tag reference and browse
                its metadata under Corpora → Contents &amp; metadata.
              </Notice>
            )}
            <QueryBuilder query={query} onChange={setQuery} onSubmit={() => !error && query.value && execute(0)} />
            <CqpPreview preview={preview} error={error} />
            {preview && !error && !unqueryable && (
              <TerminalBlock op="search" request={{ ...query, gap: Number(query.gap || 0), offset: 0, limit, context }} />
            )}
          </div>
        </Card>
      )}

      {!data ? (
        <Card>
          <EmptyState icon={TextSearch} title="No results yet">
            Choose what to find and press <strong>Search</strong> (Ctrl+Enter). Literal values are matched exactly; switch on “Regex” under Advanced for patterns. Counts refer to the whole corpus; the list shows one page at a time.
          </EmptyState>
        </Card>
      ) : (
        <div className="stack">
          {stale && (
            <Notice tone="warn">
              The query has changed since these results were produced. Run the search again before analysing or exporting.{" "}
              <Button variant="ghost" icon={RotateCcw} onClick={() => execute(0)}>Run again</Button>
            </Notice>
          )}
          <Card flush style={{ ...(stale ? { opacity: 0.55 } : {}), scrollMarginTop: 72 }} ref={resultsRef}>
            <div className="card__head card__head--pad" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div className="stat__figure stat__figure--sm" style={{ margin: 0 }}>
                  {thousands(data.total)}
                  <span className="unit">{data.total === 1 ? "match" : "matches"}</span>
                </div>
                <div className="stat__delta" title="Client wall-clock time: SSH, remote CQP and parsing">
                  <span className="pos">{rate(perMillion(data.total, ci?.tokens))}</span> per million tokens · {seconds(search.elapsed)} {search.cached ? "(cached page)" : "wall-clock"}
                  {data.total > 0 && ` · showing ${thousands(from)}–${thousands(to)}`}
                </div>
              </div>
              <div className="card__actions" style={{ alignItems: "center" }}>
                <Select small aria-label="Sort order" title="Sorted on the server, so paging and exports follow this order" value={sort}
                  options={[["", "Corpus order"], ["match", "Sort: match A–Z"], ["left", "Sort: word before"], ["right", "Sort: word after"]]}
                  onChange={(e) => { const v = e.target.value; setSort(v); !stale && execute(0, { sort: v }); }} style={{ width: 160 }} />
                <Select small aria-label="Rows per page" value={limit} options={[[25, "25 / page"], [50, "50 / page"], [100, "100 / page"]]} onChange={(e) => { const v = Number(e.target.value); setLimit(v); !stale && execute(0, { limit: v }); }} style={{ width: 118 }} />
                <Select small aria-label="Context words" value={context} options={[[2, "± 2 words"], [4, "± 4 words"], [6, "± 6 words"], [10, "± 10 words"]]} onChange={(e) => { const v = Number(e.target.value); setContext(v); !stale && execute(page.offset, { context: v }); }} style={{ width: 120 }} />
                <Button icon={ChevronLeft} aria-label="Previous page" disabled={stale || page.offset === 0 || !!busy} onClick={() => execute(Math.max(0, page.offset - page.limit))} />
                <Button icon={ChevronRight} aria-label="Next page" disabled={stale || to >= data.total || !!busy} onClick={() => execute(page.offset + page.limit)} />
                <Button variant="ghost" icon={focus ? Minimize2 : Maximize2} onClick={() => setFocus((f) => !f)} aria-pressed={focus}>{focus ? "Show query" : "Focus results"}</Button>
              </div>
            </div>
            {search.interpretation && (
              <div style={{ padding: "0 24px 16px", color: "var(--text-2)", fontSize: "var(--fs-small)", maxWidth: "110ch" }}>{search.interpretation}</div>
            )}
            <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {data.results.length ? (
                <Kwic rows={data.results} offset={page.offset} selected={selected} onSelect={setSelected} />
              ) : (
                <EmptyState icon={TextSearch} title="No matches">Check spelling and case, try “All forms (lexeme)”, or remove a filter. Zero is a valid, reportable result.</EmptyState>
              )}
            </div>
            <div className="card__foot" style={{ padding: "16px 24px", marginTop: 0 }}>
              <Button icon={FileDown} onClick={exportPage} disabled={stale || !data.results.length}>Export page…</Button>
              <Button icon={Download} onClick={() => (data.total > 5000 ? setConfirmAll(true) : exportAll())} disabled={stale || !data.total || !!busy}>Export up to 5,000…</Button>
              <Button icon={Copy} onClick={copyPage} disabled={stale || !data.results.length} title="Copy this page as tab-separated text (paste into a spreadsheet or document)">Copy page</Button>
              <Button icon={NotebookPen} onClick={addEvidence} disabled={stale || !data.results.length}>Add page to evidence</Button>
              <span className="spacer" />
              <Button variant="ghost" icon={ChartLine} onClick={() => setScreen("analysis/frequencies")} disabled={stale || !data.total}>Analyse these matches</Button>
            </div>
          </Card>

          {sel && (
            <Card title="Selected match" sub={`${search.request.corpus} · tokens ${thousands(sel.start)}–${thousands(sel.end)}${sel.source ? ` · source ${sel.source}` : ""}`}
              actions={
                <>
                  <Button variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(`${sel.left} [${sel.text}] ${sel.right}`).then(() => toast("Copied line", "neutral"))}>Copy</Button>
              <Button variant="ghost" icon={Quote} title="Copy as a citation line with corpus, source and token position" onClick={() => navigator.clipboard?.writeText(`“…${sel.left} ${sel.text} ${sel.right}…” (${search.request.corpus}${sel.source ? `, ${sel.source}` : ""}, token ${sel.start})`).then(() => toast("Copied citation", "neutral"))}>Cite</Button>
                  {search.request.corpus === "EFCAM" && (
                    <Button variant="ghost" icon={Network} onClick={() => { window.__cqpSyntaxPos = sel.start; setScreen("syntax"); }}>Inspect syntax</Button>
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
      )}

      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} title="Save search definition" text="Saved locally in preferences.json. Results are not stored — the query runs again when restored."
        footer={<><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" onClick={doSave} disabled={!saveName.trim()}>Save</Button></>}>
        <div className="dialog__body">
          <Field label="Name" htmlFor="save-name">
            <Input id="save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={200} onKeyDown={(e) => e.key === "Enter" && saveName.trim() && doSave()} />
          </Field>
        </div>
      </Dialog>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} title="Export the first 5,000 matches?"
        text={`There are ${thousands(data?.total || 0)} matches. To protect the shared server this exports only the first 5,000 (in the current sort order); the provenance file records that the export is partial.`}
        footer={<><Button onClick={() => setConfirmAll(false)}>Cancel</Button><Button variant="primary" onClick={exportAll}>Choose file…</Button></>} />
    </div>
  );
}
