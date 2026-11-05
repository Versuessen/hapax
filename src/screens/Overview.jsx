import { PageHeader } from "../components/PageHeader.jsx";
import { useMemo } from "react";
import { Activity, Bookmark, Play, Plug, Sparkles } from "lucide-react";
import { useApp, queryKey } from "../state/store.jsx";
import { Button, Card, EmptyState, ICON, Stat } from "../components/ui.jsx";
import { LineChart, Legend, SERIES } from "../components/charts.jsx";
import { compact, perMillion, rate, thousands } from "../lib/format.js";
import { corpusColor } from "../nav.js";
import { runCollocates } from "./Analysis.jsx";

export const POSITIONS = ["L4", "L3", "L2", "L1", "R1", "R2", "R3", "R4"];

/** Turn collocates.pl rows into the reference's multi-series curves. */
export function collocationSeries(groups, n = 5) {
  const rows = [...(groups || [])]
    .map((g) => ({ word: g.Word ?? g.word, total: Number(g.Total ?? 0), values: POSITIONS.map((p) => Number(g[p] ?? 0)) }))
    .filter((r) => r.word)
    .sort((a, b) => b.total - a.total);
  const top = rows.slice(0, n).map((r, i) => ({ name: r.word, values: r.values, color: SERIES[i % SERIES.length], total: r.total }));
  const next = rows.slice(n, n * 2).map((r) => ({ name: r.word, values: r.values, total: r.total }));
  return { top, next, all: rows };
}

export function CollocationChart({ result, compactLegend }) {
  const { top, next } = useMemo(() => collocationSeries(result?.groups), [result]);
  if (!top.length) return null;
  return (
    <div className="stack" style={{ gap: 18 }}>
      {!compactLegend && <Legend items={top.map((s) => ({ name: s.name, color: s.color, meta: thousands(s.total) }))} />}
      <LineChart
        labels={POSITIONS}
        series={top}
        mirrored={next}
        markIndex={null}
        height={compactLegend ? 116 : 170}
        mirroredHeight={compactLegend ? 86 : 100}
        ariaLabel={`Positional profile of the ${top.length} most frequent neighbouring words; ranks 6–10 mirrored in grey below.`}
      />
      <div className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)" }}>
        Positions L4–L1 precede the match, R1–R4 follow it. Upper curves: top {top.length} neighbours. Grey mirrored curves: ranks 6–{5 + next.length}. Raw positional counts, not association scores.
      </div>
    </div>
  );
}

export default function Overview() {
  const { info, query, search, analysis, evidence, connection, engine, setScreen, setDialog, activity, prefs, setQuery, setSearch, run, setAnalysis, toast } = useApp();
  const ci = info?.corpora?.[query.corpus];
  const live = search && search.key === queryKey(query) ? search : null;
  const coll = analysis.collocates && live && analysis.collocates.key === live.key ? analysis.collocates : null;

  const counts = useMemo(() => {
    const c = { Relevant: 0, Irrelevant: 0, Unsure: 0, Unreviewed: 0 };
    evidence.forEach((r) => (c[r.decision] = (c[r.decision] || 0) + 1));
    return c;
  }, [evidence]);
  const reviewed = evidence.length - counts.Unreviewed;
  const collTotal = coll ? coll.data.groups.reduce((s, g) => s + Number(g.Total || 0), 0) : 0;

  return (
    <div className="page">
      <PageHeader aside={ci ? `${query.corpus} · ${compact(ci.tokens)} tokens` : query.corpus} />

      <div className="grid grid--kpi" style={{ marginBottom: 16 }}>
        <Stat
          label={live ? `Matches for “${live.request.value}”` : "Matches in current search"}
          figure={live ? thousands(live.data.total) : "—"}
          delta={
            live ? (
              <><span className="pos">{rate(perMillion(live.data.total, ci?.tokens))}</span> per million</>
            ) : (
              "Run a search to begin"
            )
          }
          onClick={() => setScreen("search")}
        />
        <Stat
          label="Evidence reviewed"
          figure={thousands(reviewed)}
          unit={evidence.length ? `/ ${thousands(evidence.length)}` : null}
          delta={
            evidence.length ? (
              <><span className="pos">{counts.Relevant} relevant</span> · {counts.Unsure} unsure · {counts.Irrelevant} irrelevant</>
            ) : (
              "Add examples from a result page"
            )
          }
          onClick={() => setScreen("evidence")}
        />
        <Stat
          label="Corpus server"
          figure={connection.connected ? engine || "Online" : "Offline"}
          unit={connection.connected && engine ? "CQP" : null}
          delta={
            connection.connected ? (
              <><span className="pos">connected</span> {connection.user}@{connection.host}</>
            ) : (
              "Connect to run read-only searches"
            )
          }
          onClick={() => setDialog("connect")}
        />
      </div>

      <Card className="chart-card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="stat__label">{live ? <>Nearby words of “{live.request.value}”</> : "Nearby words"}</div>
          {coll && (
            <div style={{ marginLeft: "auto" }}>
              <Legend items={collocationSeries(coll.data.groups).top.map((s) => ({ name: s.name, color: s.color }))} />
            </div>
          )}
        </div>
        {coll ? (
          <>
            <div className="stat__figure stat__figure--sm">{thousands(collTotal)}<span className="unit">co-occurrences</span></div>
            <div className="stat__delta" style={{ marginBottom: 30 }}>
              <span className="pos">{thousands(coll.data.sampled)} matches</span> sampled · first in corpus order · L4–R4 window
            </div>
            <CollocationChart result={coll.data} compactLegend />
          </>
        ) : (
          <EmptyState
            icon={Sparkles}
            title={live ? "See which words surround your matches" : "Run a search to profile its neighbours"}
            action={
              live ? (
                <Button
                  variant="primary"
                  icon={Play}
                  onClick={async () => {
                    const r = await runCollocates({ run, query, sample: 100, key: live.key });
                    if (r) setAnalysis((a) => ({ ...a, collocates: r }));
                    else toast("No collocation result", "warning");
                  }}
                >
                  Count neighbouring words
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setScreen("search")}>Open search</Button>
              )
            }
          >
            Counts words at each position four tokens either side of the first matches (up to 500), using the university's collocates script. These are raw positional counts, not statistical association scores.
          </EmptyState>
        )}
      </Card>

      <div className="grid grid--2">
        <Card title="Session activity" sub="This window only · client wall-clock times">
          {activity.length ? (
            <ul className="nav-list" style={{ gap: 2 }}>
              {activity.map((a, i) => (
                <li key={i} className="row" style={{ minHeight: 34, flexWrap: "nowrap" }}>
                  <Activity {...ICON} style={{ color: "var(--text-3)", flex: "none" }} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                  <span className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{a.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={connection.connected ? Activity : Plug} title={connection.connected ? "Nothing run yet" : "Not connected"}>
              {connection.connected ? "Searches, analyses and exports you run appear here with their timings." : "Connect once with your university login; nothing is written on the server."}
            </EmptyState>
          )}
        </Card>
        <Card title="Saved searches" sub="Definitions stored on this computer" actions={<Button variant="ghost" onClick={() => setScreen("saved")}>Manage</Button>}>
          {prefs?.saved_searches?.length ? (
            <ul className="nav-list" style={{ gap: 2 }}>
              {prefs.saved_searches.slice(0, 6).map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    className="nav-item"
                    style={{ paddingLeft: 4 }}
                    onClick={() => {
                      setQuery((q) => ({ ...q, ...s.query }));
                      setSearch(null);
                      setScreen("search");
                    }}
                  >
                    <span className="dot" style={{ background: corpusColor(s.query.corpus), color: corpusColor(s.query.corpus), margin: "0 4px" }} aria-hidden="true" />
                    <span className="nav-item__label">{s.name}</span>
                    <span className="nav-item__meta">{s.query.corpus}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Bookmark} title="No saved searches">Save a query definition from the Search screen to reuse it later.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}
