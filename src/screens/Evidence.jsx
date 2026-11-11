import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FolderOpen, NotebookPen, Save, Trash2 } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, openDialog, saveDialog, JSON_FILTERS } from "../lib/ipc.js";
import { Button, Card, EmptyState, Kbd, Segmented, Stat } from "../components/ui.jsx";
import { exportReport } from "../lib/exportReport.js";
import { thousands } from "../lib/format.js";
import { corpusColor } from "../nav.js";
import { useUiState } from "../lib/uiState.js";

const DECISIONS = ["Relevant", "Irrelevant", "Unsure", "Unreviewed"];
const TONE = { Relevant: "var(--positive)", Irrelevant: "var(--negative)", Unsure: "var(--warning)", Unreviewed: "var(--text-4)" };
const KEY = { 1: "Relevant", 2: "Irrelevant", 3: "Unsure", 0: "Unreviewed" };

/**
 * Evidence notebook: the table on the left, the selected example's review on
 * the right (always in view). Judge one example with 1/2/3/0 — focus moves to
 * the next unreviewed one — or tick several and judge or remove them at once.
 */
export default function Evidence() {
  const { evidence, setEvidence, evidenceDirty, setEvidenceDirty, toast, log, setScreen } = useApp();
  const [filter, setFilter] = useUiState("evidence.filter", "All");
  const [sel, setSel] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [note, setNote] = useState("");
  const tableRef = useRef(null);

  const counts = useMemo(() => {
    const c = { Relevant: 0, Irrelevant: 0, Unsure: 0, Unreviewed: 0 };
    evidence.forEach((r) => c[r.decision]++);
    return c;
  }, [evidence]);
  const sources = useMemo(() => new Set(evidence.filter((r) => r.decision === "Relevant").map((r) => `${r.corpus}|${r.source}`)).size, [evidence]);
  const shown = evidence.map((r, i) => [r, i]).filter(([r]) => filter === "All" || r.decision === filter);
  const cur = sel != null ? evidence[sel] : null;
  useEffect(() => setNote(cur?.note || ""), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setChecked(new Set()), [evidence.length]);
  useEffect(() => {
    tableRef.current?.querySelector(`tr[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const patchMany = (idx, p) => {
    setEvidence((rows) => rows.map((r, j) => (idx.has(j) ? { ...r, ...p } : r)));
    setEvidenceDirty(true);
  };
  const mark = (d) => {
    if (sel == null) return;
    patchMany(new Set([sel]), { decision: d });
    const next = shown.find(([r, i]) => i > sel && r.decision === "Unreviewed");
    if (next) setSel(next[1]);
  };
  const markChecked = (d) => {
    patchMany(checked, { decision: d });
    toast(`Marked ${checked.size} example${checked.size === 1 ? "" : "s"} ${d.toLowerCase()}.`, "neutral", 3000);
  };
  const move = (d) => {
    if (!shown.length) return;
    const pos = shown.findIndex(([, i]) => i === sel);
    const next = shown[Math.max(0, Math.min(shown.length - 1, pos < 0 ? 0 : pos + d))];
    setSel(next[1]);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".scrim")) return;
      if (KEY[e.key] && sel != null) { e.preventDefault(); mark(KEY[e.key]); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
    };
    const onSave = () => evidence.length && save();
    window.addEventListener("keydown", onKey);
    window.addEventListener("hapax:save-notebook", onSave);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("hapax:save-notebook", onSave); };
  });

  /** Remove at once; the toast offers Undo (puts the examples back where they were, with their judgements). */
  const removeMany = (idx) => {
    const before = evidence;
    const n = idx.size;
    setEvidence((rows) => rows.filter((_, j) => !idx.has(j)));
    setEvidenceDirty(true);
    setSel(null);
    toast(`Removed ${n} example${n === 1 ? "" : "s"}.`, "neutral", 8000, {
      label: "Undo",
      onClick: () => { setEvidence(before); setEvidenceDirty(true); },
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
  const save = async () => {
    const p = await saveDialog({ defaultPath: "corpus_evidence_notebook.json", filters: JSON_FILTERS });
    if (!p) return;
    if (await exportReport(toast, log, "Saved evidence notebook", invoke("evidence_save", { path: p, rows: evidence }))) setEvidenceDirty(false);
  };

  const allShownChecked = shown.length > 0 && shown.every(([, i]) => checked.has(i));
  const toggleAll = () => setChecked(allShownChecked ? new Set() : new Set(shown.map(([, i]) => i)));
  const toggle = (i) => setChecked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="page">
      <PageHeader aside={evidenceDirty ? "unsaved changes — a draft is kept on this computer" : evidence.length ? "saved" : ""} />

      <div className="grid grid--kpi" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        <Stat label="Examples" figure={thousands(evidence.length)} delta={`${thousands(counts.Unreviewed)} still to review`} />
        <Stat label="Relevant" figure={thousands(counts.Relevant)} delta={<><span className="pos">{sources}</span> distinct sources</>} />
        <Stat label="Unsure" figure={thousands(counts.Unsure)} delta={<span className="warn">needs a second look</span>} />
        <Stat label="Irrelevant" figure={thousands(counts.Irrelevant)} delta="excluded by you" />
      </div>

      <div className="evidence-layout">
        <Card flush
          title="Examples"
          sub="Your judgements, stored only on this computer. They describe these examples, not the whole corpus."
          actions={
            <>
              <Button variant="ghost" icon={FolderOpen} onClick={open}>Open…</Button>
              <Button variant={evidenceDirty ? "primary" : "ghost"} icon={Save} disabled={!evidence.length} onClick={save} title="Save the notebook as a JSON file (Ctrl+S)">Save…</Button>
              <Button icon={FileDown} disabled={!evidence.length} onClick={async () => { const p = await saveDialog({ defaultPath: "evidence_review.csv" }); if (p) exportReport(toast, log, "Exported evidence", invoke("evidence_export", { path: p, rows: evidence })); }}>Export…</Button>
            </>
          }>
          <div className="row" style={{ padding: "0 24px 12px", gap: 10 }}>
            <Segmented value={filter} onChange={(v) => { setFilter(v); setChecked(new Set()); }} small label="Filter by decision" options={["All", ...DECISIONS].map((d) => [d, d === "All" ? `All ${evidence.length}` : `${d} ${counts[d]}`])} />
          </div>
          {checked.size > 0 && (
            <div className="batch-bar" role="region" aria-label="Selected examples">
              <strong>{checked.size} selected</strong>
              <span className="muted">Mark as</span>
              {DECISIONS.map((d) => <Button key={d} variant="ghost" onClick={() => markChecked(d)}><span className="dot" style={{ background: TONE[d], color: TONE[d], width: 7, height: 7 }} aria-hidden="true" />{d}</Button>)}
              <span className="spacer" />
              <Button variant="ghost" icon={Trash2} onClick={() => removeMany(checked)}>Remove</Button>
              <Button variant="ghost" onClick={() => setChecked(new Set())}>Clear selection</Button>
            </div>
          )}
          {evidence.length ? (
            <div ref={tableRef} tabIndex={0} role="region" aria-label="Evidence examples" className="table-wrap" style={{ "--table-max": "560px", borderTop: "1px solid var(--border-subtle)" }}>
              <table className="table">
                <thead><tr>
                  <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown examples" checked={allShownChecked} onChange={toggleAll} /></th>
                  <th>Decision</th><th>Context</th><th>Corpus</th><th className="num">Token</th><th>Source</th>
                </tr></thead>
                <tbody>
                  {shown.map(([r, i]) => (
                    <tr key={`${r.corpus}-${r.start}-${r.end}`} data-i={i} data-clickable="true" aria-selected={sel === i} onClick={() => setSel(i)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select example ${i + 1}`} checked={checked.has(i)} onChange={() => toggle(i)} /></td>
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
            <EmptyState icon={NotebookPen} title="No examples collected" action={<Button variant="primary" onClick={() => setScreen("search/matches")}>Go to search</Button>}>
              Add a result page from Search (Add page to evidence, Ctrl+Shift+E) or a Combine sample. Then label each example Relevant, Irrelevant or Unsure, with a note. Nothing is stored on the server.
            </EmptyState>
          )}
        </Card>

        <aside className="evidence-layout__review" aria-label="Review">
          {cur ? (
            <Card title={`Example ${sel + 1}`} sub={`${cur.corpus} · tokens ${thousands(cur.start)}–${thousands(cur.end)}${cur.source ? ` · ${cur.source}` : ""}`}
              actions={<Button variant="ghost" icon={Trash2} onClick={() => removeMany(new Set([sel]))} aria-label="Remove this example" title="Remove (can be undone)" />}>
              <div className="stack" style={{ gap: 14 }}>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "var(--text-2)", margin: 0 }}>{cur.left} <mark className="kwic__match">{cur.text}</mark> {cur.right}</p>
                <Segmented value={cur.decision} onChange={mark} label="Decision" options={DECISIONS.map((d) => [d, d])} />
                <label className="sr-only" htmlFor="ev-note">Research note</label>
                <textarea id="ev-note" className="input" rows={4} value={note} placeholder="Research note — why is this (not) an instance?" maxLength={4000} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== cur.note && patchMany(new Set([sel]), { note })} />
                <div className="muted" style={{ fontSize: "var(--fs-mono)" }}>
                  <Kbd small>1</Kbd> relevant · <Kbd small>2</Kbd> irrelevant · <Kbd small>3</Kbd> unsure · <Kbd small>0</Kbd> reset · <Kbd small>↑</Kbd><Kbd small>↓</Kbd> move
                </div>
              </div>
            </Card>
          ) : (
            <Card><EmptyState title="Select an example">Click a line, or press ↓, to review it here. Judging moves on to the next unreviewed example.</EmptyState></Card>
          )}
        </aside>
      </div>
    </div>
  );
}
