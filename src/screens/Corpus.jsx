import { clearFilters, filtersOf, withFilters } from "../lib/filters.js";
import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useState } from "react";
import { Database, Filter, Play } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Card, Chip, EmptyState, Field, Notice, Select } from "../components/ui.jsx";
import { BarCell } from "../components/charts.jsx";
import { ExplainPanel } from "../views/Analyses.jsx";
import { corpusColor, corpusFamily, orderedCorpora, isSearchable, varietyInfo } from "../nav.js";
import { Flag } from "../components/Flag.jsx";
import { compact, seconds, thousands } from "../lib/format.js";
import { Size, useUnits } from "../components/Units.jsx";
import { ViewTabs } from "../components/ui.jsx";
import { TagsView } from "../views/Tags.jsx";
import { CORPORA_VIEWS } from "../nav.js";
import { useUiState } from "../lib/uiState.js";

/** Verified caveats from the handoff (docs/07 F4, F5). Labelled, not silently "fixed". */
const CAVEATS = {
  "FROWN-LEGACY": "The registry describes FROWN as British English; the Freiburg–Brown corpus is generally documented as American English. Shown as stored.",
  "BROWN-LEGACY": "The registry points to an .info file that does not exist on the server. Attributes and searches are unaffected.",
  "BNC-BABY": "A subset of the BNC — samples and rates are not independent of BNC results.",
  DOORCORP: "Not searchable on this server: the registry declares a character encoding CWB does not recognise, so CQP rejects every query (“unrecognised CorpusCharset”). The tag inventory and metadata values below still load. A corpus administrator can fix this by setting a valid charset in the registry file.",
  EFCAM: "Learner texts with learner IDs, nationality and grades. Treat exports as potentially sensitive.",
  "BNC2014-S": "Spoken data with speaker metadata (age, gender, occupation). Treat exports as potentially sensitive.",
};

/** When the corpus list was last checked against the server, plus a re-check action. */
function useCorpusCheck() {
  const { corpusCheck, connection, discover, busy, info } = useApp();
  const total = Object.values(info?.corpora || {}).filter((c) => c.available !== false).length;
  let text;
  if (!connection.connected) text = "Not connected — showing the built-in corpus list. Connect to check what the server has now.";
  else if (!corpusCheck) text = "Checking the server's corpus registry…";
  else {
    const t = corpusCheck.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const bits = [`${total} available`];
    if (corpusCheck.added.length) bits.push(`new: ${corpusCheck.added.join(", ")}`);
    if (corpusCheck.missing.length) bits.push(`not on the server: ${corpusCheck.missing.join(", ")}`);
    text = `Checked against the server registry at ${t} · ${bits.join(" · ")}`;
  }
  const action = connection.connected
    ? <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={discover}>Check again</button>
    : null;
  return { text, action };
}

/** Status of a corpus in one or two words, with a tone for the dot. */
function corpusStatus(ci) {
  if (ci.available === false) return ["Offline", "var(--text-4)", "Not in the server registry when you connected"];
  if (ci.encoding === "<unsupported>") return ["Not searchable", "var(--warning)", "The registry declares a character encoding CQP does not accept"];
  if (ci.source === "discovered") return ["Unverified", "var(--accent-blue)", "Found on the server; not in Hapax's verified list"];
  return ["Searchable", "var(--positive)", "Available on the server"];
}

const SORTS = {
  name: { label: "Corpus", key: (c) => c.toLowerCase() },
  variety: { label: "Variety", key: null }, // null = the sidebar's grouped order
  tokens: { label: "Tokens", key: (c, ci) => ci.tokens || 0, num: true, desc: true },
  annotation: { label: "Annotation", key: (c) => corpusFamily(c)?.label || "" },
  metadata: { label: "Metadata", title: "Number of document and speaker metadata attributes (text type, date, speaker…)", key: (c, ci) => (ci.metadata || []).length, num: true, desc: true },
  status: { label: "Status", key: (c, ci) => corpusStatus(ci)[0] },
};

/** Every corpus in one sortable table; selecting a row shows its details below. */
function CorpusTable({ selected, onSelect }) {
  const { info } = useApp();
  const [sort, setSort] = useState({ by: "variety", desc: false });
  const check = useCorpusCheck();
  const base = orderedCorpora(info);
  const units = useUnits(base.filter((c) => isSearchable(info.corpora[c])));
  const rows = (() => {
    const s = SORTS[sort.by];
    if (!s.key) return sort.desc ? [...base].reverse() : base;
    const k = (c) => s.key(c, info.corpora[c]);
    return [...base].sort((a, b) => {
      const x = k(a), y = k(b);
      const r = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      return (sort.desc ? -r : r) || base.indexOf(a) - base.indexOf(b);
    });
  })();
  const header = (id, extra = {}) => {
    const s = SORTS[id];
    const on = sort.by === id;
    return (
      <th className={s.num ? "num" : undefined} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"} {...extra}>
        <button type="button" className="th-sort" title={s.title} onClick={() => setSort(on ? { by: id, desc: !sort.desc } : { by: id, desc: !!s.desc })}>
          {id === "tokens" && units.unit === "words" ? "Words" : s.label}
          <span aria-hidden="true" className="th-sort__arrow">{on ? (sort.desc ? "↓" : "↑") : ""}</span>
        </button>
      </th>
    );
  };
  return (
    <Card flush title={`${base.length} corpora`} sub={check.text} actions={check.action} style={{ marginBottom: 16 }}>
      <div tabIndex={0} role="region" aria-label="Corpora" className="table-wrap corpus-table" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <table className="table">
          <thead>
            <tr>
              {header("name")}
              {header("variety", { className: "corpus-table__variety" })}
              {header("tokens")}
              {header("annotation", { className: "corpus-table__annotation" })}
              {header("metadata", { className: "num corpus-table__meta" })}
              {header("status")}
              <th className="corpus-table__desc">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const ci = info.corpora[c];
              const [status, tone, why] = corpusStatus(ci);
              return (
                <tr key={c} data-clickable="true" aria-selected={c === selected} onClick={() => onSelect(c)}>
                  <td>
                    <button type="button" className="corpus-table__name" aria-pressed={c === selected} onClick={(e) => { e.stopPropagation(); onSelect(c); }}>
                      <Flag variety={ci.variety} note={ci.variety_note} />
                      <span>{c}</span>
                    </button>
                  </td>
                  <td className="muted corpus-table__variety" title={ci.variety_note || varietyInfo(ci.variety).label}>{ci.variety_note || varietyInfo(ci.variety).label}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>{ci.tokens ? <Size corpus={c} label={false} /> : "—"}</td>
                  <td className="muted corpus-table__annotation">{corpusFamily(c)?.label}</td>
                  <td className="num corpus-table__meta">{(ci.metadata || []).length ? `${(ci.metadata || []).length} fields` : "none"}</td>
                  <td title={why}><span className="corpus-table__status"><span className="dot" style={{ background: tone }} />{status}</span></td>
                  <td className="muted corpus-table__desc" title={ci.description}>{ci.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Corpus() {
  const { info, query, setQuery, setSearch, screen, setScreen, run, log, busy } = useApp();
  const view = screen.split("/")[1] || "about";
  const [name, setName] = useUiState("corpora.selected", query.corpus);
  const [attr, setAttr] = useState("");
  const [field, setField] = useState(null);
  const [values, setValues] = useState(null);
  const ci = info?.corpora?.[name] || info?.corpora?.[query.corpus];
  if (!info || !ci) return null;
  const meta = (ci?.metadata || []).map((m) => [m, `${m} · ${compact(ci.structural[m] ?? 0)} regions`, (ci.structural[m] ?? 0) > 10000]);
  const max = Math.max(1, ...(values?.data?.groups || []).map((g) => g.tokens));

  const load = async () => {
    const out = await run("Loading metadata values", "run_metadata", { request: { corpus: name, attribute: attr } }, { retry: () => load() });
    if (out) {
      setValues({ corpus: name, attr, data: out.data, elapsed: out.elapsed_seconds });
      log({ label: `Metadata ${name}.${attr}`, detail: `${out.data.groups.length} values · ${seconds(out.elapsed_seconds)}` });
    }
  };
  const useAsFilter = (v) => {
    // Same corpus: add to the existing filters (AND). Other corpus: start fresh.
    const base = query.corpus === name ? withFilters(query, filtersOf(query)) : clearFilters({ ...query, corpus: name });
    setQuery({ ...base, filters: [...(base.filters || []), { attr: values.attr, op: "is", value: v }] });
    setSearch(null);
    setScreen("search/matches");
  };

  return (
    <div className="page">
      <PageHeader aside={ci ? <>{name} · <Size corpus={name} /></> : name} />

      <CorpusTable selected={name} onSelect={(c) => { setName(c); setAttr(""); setValues(null); setField(null); }} />

      <ViewTabs base="corpora" views={CORPORA_VIEWS} current={view} onChange={setScreen} label="Corpus views" keyHint={false} />
      <div role="tabpanel" id={`panel-corpora-${view}`} aria-labelledby={`tab-corpora-${view}`} style={{ marginTop: 16 }}>
      {view === "about" && (
      <div className="grid grid--split" style={{ alignItems: "start" }}>
        <div className="stack">
          <Card title={ci.description} sub={<>{ci.variety_note || varietyInfo(ci.variety).label} · <SizeNote corpus={name} /> · encoding {ci.encoding} · {corpusFamily(name)?.label}</>}
            actions={<Button variant="primary" disabled={!isSearchable(ci)} onClick={() => { setQuery({ ...query, corpus: name, meta_attr: "", meta_value: "", filters: [] }); setSearch(null); setScreen("search"); }}>Search this corpus</Button>}>
            <div className="stack" style={{ gap: 16 }}>
              {ci.available === false && <Notice tone="warn">{name} was not in the server's corpus registry when you connected, so it cannot be searched now. The details below are from the app's built-in description.</Notice>}
              {ci.source === "discovered" && <Notice tone="info">{name} was found on the server and is not in Hapax's verified list. Size and attributes were read from the registry; check them before relying on them, and read the corpus documentation for its tagset.</Notice>}
              {CAVEATS[name] && <Notice tone="warn">{CAVEATS[name]}</Notice>}
              <div>
                <div className="field__label" style={{ marginBottom: 8 }}>Token attributes — select one for its meaning</div>
                <div className="row" style={{ gap: 6 }}>
                  {ci.positional.map((p) => <Chip key={p} onClick={() => setField(p)}>{p}{ci.lexeme === p ? " · lexeme" : ""}</Chip>)}
                </div>
              </div>
              {field && <FieldNote corpus={name} field={field} />}
            </div>
          </Card>

        </div>
        <Card flush title="Structural attributes" sub="Regions per attribute (verified inventory)">
          <div tabIndex={0} role="region" aria-label="Structural attributes" className="table-wrap" style={{ "--table-max": "640px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <tbody>
                {Object.entries(ci.structural).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <tr key={k}><td className="mono">{k}</td><td className="num" style={{ color: v ? "var(--text-1)" : "var(--text-4)" }}>{thousands(v)}</td></tr>
                ))}
              </tbody>
            </table>
            {!Object.keys(ci.structural).length && <EmptyState icon={Database} title="None" />}
          </div>
        </Card>
      </div>
      )}
      {view === "metadata" && (
        <div className="stack">
          <Card title="Document & speaker metadata" sub="Values and the share of the corpus they cover — use one as an exact search filter"
            actions={<Button variant="primary" icon={Play} onClick={load} disabled={!attr || !!busy}>Load values</Button>}>
            <div className="stack" style={{ gap: 12 }}>
              {meta.length ? (
                <Field label="Attribute" htmlFor="md-a">
                  <Select id="md-a" value={attr} options={[["", "Choose an attribute…"], ...meta.map(([v, l, dis]) => [v, dis ? `${l} — too large to list` : l, dis])]} onChange={(e) => setAttr(e.target.value)} />
                </Field>
              ) : <Notice tone="info">This corpus has no metadata attributes.</Notice>}
              <div className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)" }}>Attributes with more than 10,000 regions are not decoded in bulk, to protect the shared server. Type a value directly in Search instead.</div>
            </div>
          </Card>

          {values && values.corpus === name && (
            <Card flush title={<><strong>{thousands(values.data.groups.length)}</strong> values of {values.attr}</>} sub={`${seconds(values.elapsed)}${values.data.truncated ? " · first 1,000" : ""}`}>
              <div tabIndex={0} role="region" aria-label="Metadata values" className="table-wrap" style={{ "--table-max": "480px", borderTop: "1px solid var(--border-subtle)" }}>
                <table className="table">
                  <thead><tr><th>Value</th><th className="num">Regions</th><th style={{ width: "24%" }}><span className="sr-only">Share</span></th><th className="num">Tokens</th><th><span className="sr-only">Use as filter</span></th></tr></thead>
                  <tbody>
                    {values.data.groups.map((g, i) => (
                      <tr key={g.value + i}>
                        <td style={{ maxWidth: 280, overflowWrap: "anywhere" }}>{g.value || <span style={{ color: "var(--text-3)" }}>(empty)</span>}</td>
                        <td className="num">{thousands(g.regions)}</td>
                        <td><BarCell value={g.tokens} max={max} color={corpusColor(name)} /></td>
                        <td className="num">{thousands(g.tokens)}</td>
                        <td style={{ textAlign: "right" }}><Button variant="ghost" icon={Filter} onClick={() => useAsFilter(g.value)} disabled={!g.value} aria-label={`Use ${g.value} as search filter`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
      {view === "tags" && <TagsView corpus={name} />}
      </div>
    </div>
  );
}

function FieldNote({ corpus, field }) {
  const [ex, setEx] = useState(null);
  useEffect(() => {
    let live = true;
    invoke("explain_field", { corpus, field }).then((e) => live && setEx(e)).catch(() => {});
    return () => { live = false; };
  }, [corpus, field]);
  if (!ex) return null;
  return (
    <Notice tone="info">
      <strong>{field}</strong> — {ex.short}. {ex.note}
    </Notice>
  );
}


/** "1,137,466 indexed tokens (punctuation included)" or the word count, as a switch. */
function SizeNote({ corpus }) {
  const { unit, denom } = useUnits([corpus]);
  const words = unit === "words" && !denom(corpus).pending;
  return <><Size corpus={corpus} format="thousands" /> {words ? "(punctuation left out)" : "indexed (punctuation included)"}</>;
}
