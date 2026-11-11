import { useState } from "react";
import { Activity, Bookmark, ChartLine, Database, History, Layers, Play, Scale, Sparkles, TextSearch, Trash2 } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Card, EmptyState, ICON, Input, Stat } from "../components/ui.jsx";
import { Flag } from "../components/Flag.jsx";
import { QueryChips } from "../components/QueryChips.jsx";
import { thousands } from "../lib/format.js";
import { varietyInfo } from "../nav.js";
import { Rate, Size, UnitLabel } from "../components/Units.jsx";

/**
 * Home is for resuming work: status, the search in progress (or the last one)
 * with its next steps, every saved search and every recent search (run, load
 * or delete in place), and what happened this session.
 */
export default function Home() {
  const { info, query, search, evidence, connection, engine, setScreen, setDialog, activity, prefs, setPrefs, setQuery, setSearch, recent, setAsking, toast } = useApp();
  const ci = info?.corpora?.[query.corpus];
  const live = search && search.key === queryKey(query) ? search : null;
  const last = !live && recent?.length ? recent[0] : null;
  const toReview = evidence.filter((r) => r.decision === "Unreviewed").length;
  const [filter, setFilter] = useState("");

  const open = (q, runNow) => {
    setQuery((cur) => ({ ...cur, ...q }));
    setSearch(null);
    setScreen(runNow ? "search/matches" : "search");
    if (runNow) setTimeout(() => window.dispatchEvent(new CustomEvent("cqp:search")), 50);
  };
  const go = (id) => setScreen(id);

  const saved = prefs?.saved_searches || [];
  const f = filter.trim().toLowerCase();
  const savedShown = saved.filter((s) => !f || `${s.name} ${s.query.corpus} ${s.query.value || ""} ${s.query.cqp || ""}`.toLowerCase().includes(f));
  const remove = async (s) => {
    try {
      const list = await invoke("delete_saved_search", { name: s.name });
      setPrefs((p) => ({ ...p, saved_searches: list }));
      toast(`Deleted “${s.name}”.`, "neutral", 8000, {
        label: "Undo",
        onClick: () => invoke("save_search", { name: s.name, query: s.query }).then((l) => setPrefs((p) => ({ ...p, saved_searches: l }))).catch((e) => toast(e.message, "negative")),
      });
    } catch (e) {
      toast(e.message, "negative");
    }
  };

  return (
    <div className="page">
      <div className="grid grid--kpi" style={{ marginBottom: 16 }}>
        <Stat label="Corpus server" figure={connection.connected ? "Connected" : "Not connected"} small
          delta={connection.connected ? <><span className="pos">CQP {engine || ""}</span> · {connection.user}@{connection.host}</> : "Select to sign in"}
          onClick={() => setDialog("connect")} />
        <Stat label="Working corpus"
          figure={<span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>{ci && <Flag variety={ci.variety} note={ci.variety_note} size={22} />}{query.corpus}</span>}
          small delta={ci ? <><Size corpus={query.corpus} bare /> · {ci.variety_note || varietyInfo(ci.variety).label}</> : "—"}
          onClick={() => go("corpora/about")} />
        <Stat label="Evidence notebook" figure={thousands(evidence.length)} unit={evidence.length === 1 ? "example" : "examples"} small
          delta={evidence.length ? (toReview ? <span className="warn">{thousands(toReview)} still to review</span> : <span className="pos">all reviewed</span>) : "Add examples from a result page"}
          onClick={() => go("evidence")} />
      </div>

      <div className="grid grid--split" style={{ alignItems: "start", marginBottom: 16 }}>
        <Card title={live ? "Current search" : last ? "Continue where you left off" : "Start"}
          sub={live ? <>{thousands(live.data.total)} matches · <Rate count={live.data.total} corpus={live.request.corpus} /> <UnitLabel corpora={[live.request.corpus]} /></> : last ? `Last run ${new Date(last.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${thousands(last.total)} matches` : "Three ways in, depending on what you know"}>
          {live || last ? (
            <div className="stack" style={{ gap: 16 }}>
              <QueryChips q={live ? live.request : last.query} />
              <div className="row" style={{ gap: 8 }}>
                {live ? (
                  <>
                    <Button variant="primary" icon={TextSearch} onClick={() => go("search/matches")}>Show matches</Button>
                    <Button icon={ChartLine} onClick={() => go("search/counts")}>Counts</Button>
                    <Button icon={Layers} onClick={() => go("search/spread")}>Spread</Button>
                    <Button icon={Scale} onClick={() => go("search/compare")}>Compare</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" icon={Play} onClick={() => open(last.query, true)}>{connection.connected ? "Run again" : "Connect and run"}</Button>
                    <Button onClick={() => open(last.query, false)}>Load into Search</Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <ul className="start-list">
              <li><button type="button" className="start-item" onClick={() => go("search")}><TextSearch {...ICON} aria-hidden="true" /><span><strong>Search</strong><span className="muted">You know the word, tag or phrase.</span></span></button></li>
              <li><button type="button" className="start-item" onClick={() => { setAsking(true); go("search"); }}><Sparkles {...ICON} aria-hidden="true" /><span><strong>Ask a question</strong><span className="muted">You have a question but not the corpus's tags or CQP.</span></span></button></li>
              <li><button type="button" className="start-item" onClick={() => go("corpora/about")}><Database {...ICON} aria-hidden="true" /><span><strong>Explore the corpora</strong><span className="muted">See what each corpus contains before choosing one.</span></span></button></li>
            </ul>
          )}
        </Card>
        <Card title="This session" sub="Cleared when you close the app · client wall-clock times">
          {activity.length ? (
            <ul className="nav-list" style={{ gap: 2 }}>
              {activity.slice(0, 8).map((a, i) => (
                <li key={i} className="row" style={{ minHeight: 28, flexWrap: "nowrap" }}>
                  <Activity {...ICON} style={{ color: "var(--text-3)", flex: "none" }} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                  <span className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{a.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted" style={{ fontSize: "var(--fs-small)" }}>Searches, counts and exports you run appear here.</div>
          )}
        </Card>
      </div>

      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <Card flush title={`Saved searches${saved.length ? ` · ${saved.length}` : ""}`} sub="Stored in preferences.json on this computer; results are recomputed each time"
          actions={saved.length > 6 ? (
            <><label className="sr-only" htmlFor="saved-filter">Filter saved searches</label><Input id="saved-filter" small value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" style={{ width: 150 }} /></>
          ) : null}>
          {saved.length ? (
            <SearchList items={savedShown.map((s) => ({ key: s.name, title: s.name, query: s.query, onRun: () => open(s.query, true), onLoad: () => open(s.query, false), onDelete: () => remove(s) }))}
              empty="No saved search matches the filter." />
          ) : (
            <EmptyState icon={Bookmark} title="Nothing saved yet">Use <strong>Save</strong> in the Search query panel (Ctrl+S) to keep a query you want to rerun.</EmptyState>
          )}
        </Card>
        <Card flush title={`Recent searches${recent?.length ? ` · ${recent.length}` : ""}`} sub="The last 20 searches you ran, newest first, on this computer">
          {recent?.length ? (
            <SearchList items={recent.map((r) => ({
              key: r.at, query: r.query, meta: `${thousands(Number(r.total))} matches · ${new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
              onRun: () => open(r.query, true), onLoad: () => open(r.query, false),
            }))} />
          ) : (
            <EmptyState icon={History} title="No searches run yet">Searches you run appear here automatically.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Saved or recent searches: chips, optional title and meta line; Run, Load, Delete. */
function SearchList({ items, empty }) {
  if (!items.length) return <div className="muted" style={{ padding: "4px 24px 20px", fontSize: "var(--fs-small)" }}>{empty}</div>;
  return (
    <ul className="search-list">
      {items.map((it) => (
        <li key={it.key} className="search-list__item">
          <div style={{ minWidth: 0 }}>
            {it.title && <div className="search-list__title">{it.title}</div>}
            <QueryChips q={it.query} />
            {it.meta && <div className="search-list__meta">{it.meta}</div>}
          </div>
          <div className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
            <Button variant="ghost" onClick={it.onLoad} title="Load into the Search query panel">Load</Button>
            <Button icon={Play} onClick={it.onRun} title="Load and run">Run</Button>
            {it.onDelete && <Button variant="ghost" icon={Trash2} aria-label={`Delete ${it.title}`} title="Delete (can be undone)" onClick={it.onDelete} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
