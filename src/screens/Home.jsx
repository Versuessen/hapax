import { PageHeader } from "../components/PageHeader.jsx";
import { useMemo } from "react";
import { Activity, ChartLine, Database, Layers, Play, Scale, Sparkles, TextSearch } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { Button, Card, Chip, ICON, Stat } from "../components/ui.jsx";
import { Flag } from "../components/Flag.jsx";
import { describeFollowers } from "../lib/sequence.js";
import { describeFilters } from "../lib/filters.js";
import { LineChart, Legend, SERIES } from "../components/charts.jsx";
import { compact, perMillion, rate, thousands } from "../lib/format.js";
import { corpusColor, varietyInfo } from "../nav.js";
import { queryLabel } from "../lib/query.js";
import { Rate, Size, UnitLabel } from "../components/Units.jsx";

/** A search as a short line of chips: corpus, words, filters. */
function SearchChips({ q }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <Chip dot={corpusColor(q.corpus)}>{q.corpus}</Chip>
      <Chip>{queryLabel(q)}</Chip>
      {!q.manual && describeFollowers(q).map((d) => <Chip key={d}>{d}</Chip>)}
      {describeFilters(q).map((d) => <Chip key={d} tone="warn">{d}</Chip>)}
    </div>
  );
}

/**
 * Home is for resuming work: what is connected and selected, the search in
 * progress (or the last one) with its next steps, and recent and saved searches.
 */
export default function Overview() {
  const { info, query, search, evidence, connection, engine, setScreen, setDialog, activity, prefs, setQuery, setSearch, recent } = useApp();
  const ci = info?.corpora?.[query.corpus];
  const live = search && search.key === queryKey(query) ? search : null;
  const last = !live && recent?.length ? recent[0] : null;
  const toReview = evidence.filter((r) => r.decision === "Unreviewed").length;

  const open = (q, runNow) => {
    setQuery((cur) => ({ ...cur, ...q }));
    setSearch(null);
    setScreen("find/search");
    if (runNow) setTimeout(() => window.dispatchEvent(new CustomEvent("cqp:search")), 50);
  };
  const go = (id) => setScreen(id);

  return (
    <div className="page">
      <PageHeader />
      <div className="grid grid--kpi" style={{ marginBottom: 16 }}>
        <Stat
          label="Corpus server"
          figure={connection.connected ? "Connected" : "Not connected"}
          small
          delta={connection.connected ? <><span className="pos">CQP {engine || ""}</span> · {connection.user}@{connection.host}</> : "Select to sign in"}
          onClick={() => setDialog("connect")}
        />
        <Stat
          label="Working corpus"
          figure={<span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>{ci && <Flag variety={ci.variety} note={ci.variety_note} size={22} />}{query.corpus}</span>}
          small
          delta={ci ? <><Size corpus={query.corpus} bare /> · {ci.variety_note || varietyInfo(ci.variety).label}</> : "—"}
          onClick={() => go("corpora/details")}
        />
        <Stat
          label="Evidence notebook"
          figure={thousands(evidence.length)}
          unit={evidence.length === 1 ? "example" : "examples"}
          small
          delta={evidence.length ? (toReview ? <span className="warn">{thousands(toReview)} still to review</span> : <span className="pos">all reviewed</span>) : "Add examples from a result page"}
          onClick={() => go("evidence")}
        />
      </div>

      <div className="grid grid--split" style={{ alignItems: "start" }}>
        <Card title={live ? "Current search" : last ? "Continue where you left off" : "Start"}
          sub={live ? <>{thousands(live.data.total)} matches · <Rate count={live.data.total} corpus={live.request.corpus} /> <UnitLabel corpora={[live.request.corpus]} /></> : last ? `Last run ${new Date(last.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${thousands(last.total)} matches` : "Three ways in, depending on what you know"}>
          {live || last ? (
            <div className="stack" style={{ gap: 16 }}>
              <SearchChips q={live ? live.request : last.query} />
              <div className="row" style={{ gap: 8 }}>
                {live ? (
                  <>
                    <Button variant="primary" icon={TextSearch} onClick={() => go("find/search")}>Show results</Button>
                    <Button icon={ChartLine} onClick={() => go("analyse/counts")}>Count by annotation</Button>
                    <Button icon={Layers} onClick={() => go("analyse/spread")}>Spread across texts</Button>
                    <Button icon={Scale} onClick={() => go("analyse/compare")}>Compare corpora</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" icon={Play} onClick={() => open(last.query, true)}>{connection.connected ? "Run again" : "Connect and run"}</Button>
                    <Button onClick={() => open(last.query, false)}>Edit</Button>
                    <Button variant="ghost" onClick={() => go("find/search")}>New search</Button>
                  </>
                )}
              </div>
              {!connection.connected && !live && <div className="muted" style={{ fontSize: "var(--fs-small)" }}>Connect first to run it again.</div>}
            </div>
          ) : (
            <ul className="start-list">
              <li><button type="button" className="start-item" onClick={() => go("find/search")}><TextSearch {...ICON} aria-hidden="true" /><span><strong>Search</strong><span className="muted">You know the word, tag or phrase.</span></span></button></li>
              <li><button type="button" className="start-item" onClick={() => go("find/guided")}><Sparkles {...ICON} aria-hidden="true" /><span><strong>Guided search</strong><span className="muted">You have a question but not the corpus's tags or CQP.</span></span></button></li>
              <li><button type="button" className="start-item" onClick={() => go("corpora/details")}><Database {...ICON} aria-hidden="true" /><span><strong>Explore the corpora</strong><span className="muted">See what each corpus contains before choosing one.</span></span></button></li>
            </ul>
          )}
        </Card>

        <div className="stack">
          <Card flush title="Recent searches" actions={recent?.length ? <Button variant="ghost" onClick={() => go("find/saved")}>All</Button> : null}>
            {recent?.length ? (
              <ul className="home-list">
                {recent.slice(0, 5).map((r) => (
                  <li key={r.at}>
                    <button type="button" className="home-list__item" onClick={() => open(r.query, false)} title="Load into Search">
                      <span className="dot" style={{ background: corpusColor(r.query.corpus), color: corpusColor(r.query.corpus) }} aria-hidden="true" />
                      <span className="home-list__label">{[r.query.value, ...(r.query.next || []).map((t) => t.value)].join(" ")}{describeFilters(r.query).length ? " · filtered" : ""}</span>
                      <span className="home-list__meta">{r.query.corpus} · {thousands(r.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted" style={{ padding: "0 var(--space-6) var(--space-5)", fontSize: "var(--fs-small)" }}>Searches you run appear here.</div>
            )}
          </Card>
          <Card flush title="Saved searches" actions={<Button variant="ghost" onClick={() => go("find/saved")}>Manage</Button>}>
            {prefs?.saved_searches?.length ? (
              <ul className="home-list">
                {prefs.saved_searches.slice(0, 5).map((s) => (
                  <li key={s.name}>
                    <button type="button" className="home-list__item" onClick={() => open(s.query, false)} title="Load into Search">
                      <span className="dot" style={{ background: corpusColor(s.query.corpus), color: corpusColor(s.query.corpus) }} aria-hidden="true" />
                      <span className="home-list__label">{s.name}</span>
                      <span className="home-list__meta">{s.query.corpus}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted" style={{ padding: "0 var(--space-6) var(--space-5)", fontSize: "var(--fs-small)" }}>Save a search with Save (Ctrl+S) to keep it here.</div>
            )}
          </Card>
        </div>
      </div>

      {activity.length > 0 && (
        <Card title="This session" sub="Cleared when you close the app · client wall-clock times" style={{ marginTop: 16 }}>
          <ul className="nav-list" style={{ gap: 2 }}>
            {activity.slice(0, 6).map((a, i) => (
              <li key={i} className="row" style={{ minHeight: 30, flexWrap: "nowrap" }}>
                <Activity {...ICON} style={{ color: "var(--text-3)", flex: "none" }} aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                <span className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{a.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
