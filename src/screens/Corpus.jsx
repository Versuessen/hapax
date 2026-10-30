import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useState } from "react";
import { Database, Filter, Play } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Card, Chip, EmptyState, Field, Notice, Select } from "../components/ui.jsx";
import { BarCell } from "../components/charts.jsx";
import { ExplainPanel } from "./Analysis.jsx";
import { CORPUS_ORDER, corpusColor, corpusFamily, orderedCorpora, isSearchable } from "../nav.js";
import { compact, seconds, thousands } from "../lib/format.js";

/** Verified caveats from the handoff (docs/07 F4, F5). Labelled, not silently "fixed". */
const CAVEATS = {
  "FROWN-LEGACY": "The registry describes FROWN as British English; the Freiburg–Brown corpus is generally documented as American English. Shown as stored.",
  "BROWN-LEGACY": "The registry points to an .info file that does not exist on the server. Attributes and searches are unaffected.",
  "BNC-BABY": "A subset of the BNC — samples and rates are not independent of BNC results.",
  DOORCORP: "Not searchable on this server: the registry declares a character encoding CWB does not recognise, so CQP rejects every query (“unrecognised CorpusCharset”). The tag inventory and metadata values below still load. A corpus administrator can fix this by setting a valid charset in the registry file.",
  EFCAM: "Learner texts with learner IDs, nationality and grades. Treat exports as potentially sensitive.",
  "BNC2014-S": "Spoken data with speaker metadata (age, gender, occupation). Treat exports as potentially sensitive.",
};

/** One line stating when the corpus list was last checked against the server. */
function CorpusCheck() {
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
  return (
    <div className="row mono" style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12, gap: 12 }}>
      <span>{text}</span>
      {connection.connected && <button type="button" className="btn btn--ghost" style={{ height: 28 }} disabled={!!busy} onClick={discover}>Check again</button>}
    </div>
  );
}

export default function Corpus() {
  const { info, query, setQuery, setSearch, setScreen, run, log, busy } = useApp();
  const [name, setName] = useState(query.corpus);
  const [attr, setAttr] = useState("");
  const [field, setField] = useState(null);
  const [values, setValues] = useState(null);
  const ci = info?.corpora?.[name];
  if (!info) return null;
  const meta = (ci?.metadata || []).map((m) => [m, `${m} · ${compact(ci.structural[m] ?? 0)} regions`, (ci.structural[m] ?? 0) > 10000]);
  const max = Math.max(1, ...(values?.data?.groups || []).map((g) => g.tokens));

  const load = async () => {
    const out = await run("Loading metadata values", "run_metadata", { request: { corpus: name, attribute: attr } });
    if (out) {
      setValues({ corpus: name, attr, data: out.data, elapsed: out.elapsed_seconds });
      log({ label: `Metadata ${name}.${attr}`, detail: `${out.data.groups.length} values · ${seconds(out.elapsed_seconds)}` });
    }
  };
  const useAsFilter = (v) => {
    setQuery({ ...query, corpus: name, meta_attr: values.attr, meta_value: v });
    setSearch(null);
    setScreen("search");
  };

  return (
    <div className="page">
      <PageHeader aside={ci ? `${name} · ${compact(ci.tokens)} tokens` : name} />

      <CorpusCheck />
      <div className="grid grid--kpi" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {orderedCorpora(info).map((c) => (
          <button key={c} type="button" className="card" onClick={() => { setName(c); setAttr(""); setValues(null); setField(null); }} aria-pressed={c === name}
            style={{ textAlign: "left", padding: 18, color: "inherit", borderColor: c === name ? "var(--border-strong)" : undefined, background: c === name ? "linear-gradient(180deg, var(--surface-active-top), var(--surface-active-bottom))" : undefined }}>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <span className="dot" style={{ background: corpusColor(c), color: corpusColor(c) }} />
              <span style={{ fontWeight: 500 }}>{c}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>{info.corpora[c].available === false ? "offline" : info.corpora[c].tokens ? compact(info.corpora[c].tokens) : "—"}</span>
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 13, marginTop: 8, lineHeight: 1.4 }}>{info.corpora[c].description}</div>
          </button>
        ))}
      </div>

      <div className="grid grid--split" style={{ alignItems: "start" }}>
        <div className="stack">
          <Card title={ci.description} sub={`${thousands(ci.tokens)} indexed tokens (incl. punctuation) · encoding ${ci.encoding} · ${corpusFamily(name)?.label}`}
            actions={<Button variant="primary" disabled={!isSearchable(ci)} onClick={() => { setQuery({ ...query, corpus: name, meta_attr: "", meta_value: "" }); setSearch(null); setScreen("search"); }}>Search this corpus</Button>}>
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

          <Card title="Document & speaker metadata" sub="Values and the share of the corpus they cover — use one as an exact search filter"
            actions={<Button variant="primary" icon={Play} onClick={load} disabled={!attr || !!busy}>Load values</Button>}>
            <div className="stack" style={{ gap: 12 }}>
              {meta.length ? (
                <Field label="Attribute" htmlFor="md-a">
                  <Select id="md-a" value={attr} options={[["", "Choose an attribute…"], ...meta.map(([v, l, dis]) => [v, dis ? `${l} — too large to list` : l, dis])]} onChange={(e) => setAttr(e.target.value)} />
                </Field>
              ) : <Notice tone="info">This corpus has no metadata attributes.</Notice>}
              <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>Attributes with more than 10,000 regions are not decoded in bulk, to protect the shared server. Type a value directly in Search instead.</div>
            </div>
          </Card>

          {values && values.corpus === name && (
            <Card flush title={<><strong>{thousands(values.data.groups.length)}</strong> values of {values.attr}</>} sub={`${seconds(values.elapsed)}${values.data.truncated ? " · first 1,000" : ""}`}>
              <div className="table-wrap" style={{ "--table-max": "480px", borderTop: "1px solid var(--border-subtle)" }}>
                <table className="table">
                  <thead><tr><th>Value</th><th className="num">Regions</th><th style={{ width: "24%" }} /><th className="num">Tokens</th><th /></tr></thead>
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

        <Card flush title="Structural attributes" sub="Regions per attribute (verified inventory)">
          <div className="table-wrap" style={{ "--table-max": "640px", borderTop: "1px solid var(--border-subtle)" }}>
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

export { ExplainPanel };
