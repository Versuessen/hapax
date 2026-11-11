import { useEffect, useState } from "react";
import { BookOpen, Play, Search as SearchIcon } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Card, EmptyState, Field, ICON, Input, ScrollTable, Select } from "../components/ui.jsx";
import { BarCell } from "../components/charts.jsx";
import { FIELD_LABELS } from "../components/QueryBuilder.jsx";
import { corpusColor } from "../nav.js";
import { thousands } from "../lib/format.js";
import { ExplainPanel } from "./Analyses.jsx";

/**
 * Corpora › Tags: the codes a corpus uses (server, with frequencies) beside
 * the packaged codebook; select a code to see what it means.
 */
export function TagsView({ corpus }) {
  const { info, run, analysis, setAnalysis, busy } = useApp();
  const ci = info?.corpora?.[corpus];
  const opts = ["pos", "class", "rel", "usas"].filter((f) => ci?.positional?.includes(f)).map((f) => [f, FIELD_LABELS[f]]);
  const [field, setField] = useState("pos");
  const [glossary, setGlossary] = useState([]);
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState(null);
  const res = analysis.lexicon && analysis.lexicon.corpus === corpus && analysis.lexicon.field === field ? analysis.lexicon : null;

  useEffect(() => {
    setPick(null);
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
            <Field label="Attribute" htmlFor="cd-f" style={{ minWidth: 200 }}>
              <Select id="cd-f" value={field} options={opts.length ? opts : [["pos", "No tag attributes"]]} onChange={(e) => setField(e.target.value)} />
            </Field>
          </div>
        </Card>
        {res && (
          <Card flush title={<><strong>{thousands(res.data.groups.length)}</strong> codes</>} sub={`${corpus} · ${field}${res.data.truncated ? " · first 2,500" : ""}`}>
            <div tabIndex={0} role="region" aria-label="Annotation codes" className="table-wrap" style={{ "--table-max": "520px", borderTop: "1px solid var(--border-subtle)" }}>
              <table className="table">
                <thead><tr><th>Code</th><th>Meaning</th><th style={{ width: "22%" }}><span className="sr-only">Share</span></th><th className="num">Tokens</th></tr></thead>
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
          <div tabIndex={0} role="region" aria-label="Codebook" className="table-wrap" style={{ "--table-max": "560px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <tbody>
                {gl.slice(0, 400).map((g, i) => (
                  <tr key={g.category + g.code + i} data-clickable={g.category === "POS"} onClick={() => g.category === "POS" && (setField("pos"), setPick(g.code))} title={g.note}>
                    <td className="mono" style={{ width: 90 }}>{g.code}</td>
                    <td>{g.label}</td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-mono)", textAlign: "right" }}>{g.category}</td>
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

