import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useMemo, useState } from "react";
import { FileDown, FolderOpen, NotebookPen, Save, Trash2 } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, openDialog, saveDialog, JSON_FILTERS } from "../lib/ipc.js";
import { Button, Card, EmptyState, Segmented, Stat, Notice } from "../components/ui.jsx";
import { exportReport } from "./Search.jsx";
import { thousands } from "../lib/format.js";
import { corpusColor } from "../nav.js";

const DECISIONS = ["Relevant", "Irrelevant", "Unsure", "Unreviewed"];
const TONE = { Relevant: "var(--positive)", Irrelevant: "var(--negative)", Unsure: "var(--warning)", Unreviewed: "var(--text-4)" };

export default function Evidence() {
  const { evidence, setEvidence, evidenceDirty, setEvidenceDirty, toast, log, setScreen } = useApp();
  const [filter, setFilter] = useState("All");
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState("");

  const counts = useMemo(() => {
    const c = { Relevant: 0, Irrelevant: 0, Unsure: 0, Unreviewed: 0 };
    evidence.forEach((r) => c[r.decision]++);
    return c;
  }, [evidence]);
  const sources = useMemo(() => new Set(evidence.filter((r) => r.decision === "Relevant").map((r) => `${r.corpus}|${r.source}`)).size, [evidence]);
  const shown = evidence.map((r, i) => [r, i]).filter(([r]) => filter === "All" || r.decision === filter);
  const cur = sel != null ? evidence[sel] : null;
  useEffect(() => setNote(cur?.note || ""), [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (i, p) => {
    setEvidence((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setEvidenceDirty(true);
  };
  const mark = (d) => {
    if (sel == null) return;
    patch(sel, { decision: d });
    const next = shown.find(([r, i]) => i > sel && r.decision === "Unreviewed");
    if (next) setSel(next[1]);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (sel == null || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = { 1: "Relevant", 2: "Irrelevant", 3: "Unsure", 0: "Unreviewed" }[e.key];
      if (m) { e.preventDefault(); mark(m); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Remove at once; the toast offers Undo (puts the example back where it was, with its judgement). */
  const remove = (i) => {
    const row = evidence[i];
    setEvidence((rows) => rows.filter((_, j) => j !== i));
    setEvidenceDirty(true);
    setSel(null);
    toast(`Removed example ${i + 1}.`, "neutral", 8000, {
      label: "Undo",
      onClick: () => { setEvidence((rows) => [...rows.slice(0, i), row, ...rows.slice(i)]); setEvidenceDirty(true); setSel(i); },
    });
  };

  const open = async () => {
    const p = await openDialog({ filters: JSON_FILTERS, title: "Open evidence notebook" });
    if (!p) return;
    try {
      const rows = await invoke("evidence_open", { path: p });
      setEvidence(rows);
      setEvidenceDirty(false);
      setSel(null);
      toast(`Opened ${thousands(rows.length)} examples.`, "positive");
    } catch (e) {
      toast(e.message, "negative");
    }
  };

  return (
    <div className="page">
      <PageHeader aside={evidenceDirty ? "unsaved changes" : evidence.length ? "saved" : ""} />

      <div className="grid grid--kpi" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        <Stat label="Examples" figure={thousands(evidence.length)} delta={`${thousands(counts.Unreviewed)} still to review`} />
        <Stat label="Relevant" figure={thousands(counts.Relevant)} delta={<><span className="pos">{sources}</span> distinct sources</>} />
        <Stat label="Unsure" figure={thousands(counts.Unsure)} delta={<span className="warn">needs a second look</span>} />
        <Stat label="Irrelevant" figure={thousands(counts.Irrelevant)} delta="excluded by you" />
      </div>

      <Card flush
        title="Examples"
        sub="Your judgements, stored only on this computer. They describe these examples, not the whole corpus."
        actions={
          <>
            <Button variant="ghost" icon={FolderOpen} onClick={open}>Open…</Button>
            <Button variant="ghost" icon={Save} disabled={!evidence.length} onClick={async () => { const p = await saveDialog({ defaultPath: "corpus_evidence_notebook.json", filters: JSON_FILTERS }); if (!p) return; if (await exportReport(toast, log, "Saved evidence notebook", invoke("evidence_save", { path: p, rows: evidence }))) setEvidenceDirty(false); }}>Save…</Button>
            <Button icon={FileDown} disabled={!evidence.length} onClick={async () => { const p = await saveDialog({ defaultPath: "evidence_review.csv" }); if (p) exportReport(toast, log, "Exported evidence", invoke("evidence_export", { path: p, rows: evidence })); }}>Export…</Button>
          </>
        }>
        <div style={{ padding: "0 24px 16px" }}>
          <Segmented value={filter} onChange={setFilter} small label="Filter by decision" options={["All", ...DECISIONS].map((d) => [d, d === "All" ? `All ${evidence.length}` : `${d} ${counts[d]}`])} />
        </div>
        {evidence.length ? (
          <div tabIndex={0} role="region" aria-label="Evidence examples" className="table-wrap" style={{ "--table-max": "460px", borderTop: "1px solid var(--border-subtle)" }}>
            <table className="table">
              <thead><tr><th>Decision</th><th>Context</th><th>Corpus</th><th className="num">Token</th><th>Source</th></tr></thead>
              <tbody>
                {shown.map(([r, i]) => (
                  <tr key={`${r.corpus}-${r.start}-${r.end}`} data-clickable="true" aria-selected={sel === i} onClick={() => setSel(i)}>
                    <td style={{ whiteSpace: "nowrap" }}><span className="row" style={{ flexWrap: "nowrap", gap: 8 }}><span className="dot" style={{ background: TONE[r.decision], color: TONE[r.decision] }} />{r.decision}</span></td>
                    <td style={{ maxWidth: 520 }}>
                      <span style={{ color: "var(--text-2)" }}>…{r.left.split(" ").slice(-4).join(" ")} </span>
                      <mark className="kwic__match">{r.text}</mark>
                      <span style={{ color: "var(--text-2)" }}> {r.right.split(" ").slice(0, 4).join(" ")}…</span>
                      {r.note && <div className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)", marginTop: 2 }}>“{r.note}”</div>}
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}><span className="dot" style={{ background: corpusColor(r.corpus), display: "inline-block", marginRight: 8, boxShadow: "none", width: 6, height: 6 }} />{r.corpus}</td>
                    <td className="num">{thousands(r.start)}</td>
                    <td className="mono muted">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={NotebookPen} title="No examples collected" action={<Button variant="primary" onClick={() => setScreen("search")}>Go to search</Button>}>
            Add a result page from Search or a workflow sample. Then label each example Relevant, Irrelevant or Unsure, with a note. Nothing is stored on the server.
          </EmptyState>
        )}
      </Card>

      {cur && (
        <Card style={{ marginTop: 16 }} title="Review" sub={`${cur.corpus} · tokens ${thousands(cur.start)}–${thousands(cur.end)} · keys 1 relevant, 2 irrelevant, 3 unsure, 0 reset`}
          actions={<Button variant="ghost" icon={Trash2} onClick={() => remove(sel)}>Remove</Button>}>
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-2)" }}>{cur.left} <mark className="kwic__match">{cur.text}</mark> {cur.right}</p>
            <Segmented value={cur.decision} onChange={mark} label="Decision" options={DECISIONS.map((d) => [d, d])} />
            <div className="row" style={{ alignItems: "stretch", flexWrap: "nowrap" }}>
              <label className="sr-only" htmlFor="ev-note">Research note</label>
              <textarea id="ev-note" className="input" value={note} placeholder="Research note — why is this (not) an instance?" maxLength={4000} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== cur.note && patch(sel, { note })} />
            </div>
          </div>
        </Card>
      )}

      {evidenceDirty && evidence.length > 0 && (
        <div style={{ marginTop: 16 }}><Notice tone="warn">This notebook has unsaved changes. A draft is kept on this computer and restored if the app closes; use <strong>Save…</strong> to keep it as a JSON file you can share or archive.</Notice></div>
      )}

    </div>
  );
}
