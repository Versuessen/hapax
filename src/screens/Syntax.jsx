import { PageHeader } from "../components/PageHeader.jsx";
import { useEffect, useMemo, useState } from "react";
import { FileDown, Network, Play } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, saveDialog } from "../lib/ipc.js";
import { Button, Card, Chip, EmptyState, Field, Input, Notice } from "../components/ui.jsx";
import { exportReport } from "./Search.jsx";
import { seconds, thousands } from "../lib/format.js";

const isNum = (s) => /^\d+$/.test(s || "");

function ArcDiagram({ tokens, hover, setHover }) {
  const layout = useMemo(() => {
    let x = 16;
    const xs = tokens.map((t) => {
      const w = Math.max(36, t.word.length * 8.2 + 22);
      const cx = x + w / 2;
      x += w + 8;
      return { cx, w };
    });
    const idx = Object.fromEntries(tokens.map((t, i) => [t.id, i]));
    const arcs = tokens
      .map((t, i) => (isNum(t.head) && t.head !== "0" && idx[t.head] != null ? { from: idx[t.head], to: i, rel: t.rel } : null))
      .filter(Boolean);
    // Distinct height per arc (span, then order) so long arcs never share an apex.
    const sorted = [...arcs].sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from) || a.from - b.from);
    sorted.forEach((a, k) => (a.h = 22 + k * 15));
    const top = 34 + (sorted.at(-1)?.h || 0);
    return { xs, arcs, width: x + 8, top, height: top + 64 };
  }, [tokens]);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="chart" width={layout.width} height={layout.height} role="img" aria-label="Dependency arcs; the token table lists the same relations as text">
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--text-3)" />
          </marker>
          <marker id="arrow-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--accent-blue)" />
          </marker>
        </defs>
        {layout.arcs.map((a, k) => {
          const x1 = layout.xs[a.from].cx, x2 = layout.xs[a.to].cx;
          const h = a.h;
          const base = layout.top;
          const hi = hover === a.to || hover === a.from;
          const undef = a.rel === "__UNDEF__";
          return (
            <g key={k}>
              <path d={`M${x1},${base} C${x1},${base - h} ${x2},${base - h} ${x2},${base - 2}`} fill="none"
                stroke={hi ? "var(--accent-blue)" : "var(--text-3)"} strokeWidth={hi ? 1.8 : 1.2} strokeDasharray={undef ? "3 4" : undefined}
                markerEnd={`url(#${hi ? "arrow-hi" : "arrow"})`} />
              <rect x={(x1 + x2) / 2 - a.rel.length * 3.8 - 5} y={base - h * 0.75 - 9} width={a.rel.length * 7.6 + 10} height={16} rx={4} fill="var(--surface-1)" />
              <text x={(x1 + x2) / 2} y={base - h * 0.75 + 3} textAnchor="middle" style={{ fill: hi ? "var(--text-1)" : "var(--text-2)" }}>{a.rel}</text>
            </g>
          );
        })}
        {tokens.map((t, i) => {
          const { cx, w } = layout.xs[i];
          const root = t.head === "0";
          return (
            <g key={t.id + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
              {root && <line x1={cx} x2={cx} y1={8} y2={layout.top - 4} stroke="var(--accent-yellow)" strokeWidth={1.5} markerEnd="url(#arrow)" />}
              <rect x={cx - w / 2} y={layout.top + 4} width={w} height={30} rx={8} fill={hover === i ? "var(--surface-hover)" : "var(--surface-2)"} stroke={root ? "var(--accent-yellow)" : "var(--border)"} />
              <text x={cx} y={layout.top + 23} textAnchor="middle" style={{ fill: "var(--text-1)", fontFamily: "var(--font-sans)", fontSize: 13 }}>{t.word}</text>
              <text x={cx} y={layout.top + 52} textAnchor="middle" style={{ fontSize: 11 }}>{t.pos}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Syntax() {
  const { run, toast, log, busy } = useApp();
  const [pos, setPos] = useState(() => String(window.__cqpSyntaxPos ?? ""));
  const [res, setRes] = useState(null);
  const [hover, setHover] = useState(null);

  const go = async (p = pos) => {
    const position = Number(p);
    if (!Number.isInteger(position) || position < 0) return toast("Enter a token position (a whole number).", "warning");
    const out = await run("Decoding EFCAM sentence", "run_syntax", { request: { corpus: "EFCAM", position } });
    if (out) {
      setRes({ data: out.data, elapsed: out.elapsed_seconds, position });
      log({ label: `EFCAM sentence at ${thousands(position)}`, detail: `${out.data.tokens.length} tokens` });
    }
  };
  useEffect(() => {
    if (window.__cqpSyntaxPos != null) {
      const p = window.__cqpSyntaxPos;
      window.__cqpSyntaxPos = null;
      go(p);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const d = res?.data?.diagnostics;
  return (
    <div className="page">
      <PageHeader aside="EFCAM" />
      <div className="stack">
        <Card title="Inspect a sentence's dependency relations" sub="EF-Cambridge learner corpus only · select an EFCAM match in Search to jump here"
          actions={<Button variant="primary" icon={Play} onClick={() => go()} disabled={!pos || !!busy}>Inspect</Button>}>
          <Field label="Token position" htmlFor="syn-p" hint="0 – 36,353,680">
            <Input id="syn-p" mono value={pos} onChange={(e) => setPos(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && go()} style={{ maxWidth: 240 }} inputMode="numeric" />
          </Field>
        </Card>
        {res ? (
          <>
            <Card title={<><strong>{res.data.tokens.length}</strong> tokens · sentence from position {thousands(res.data.start)}</>} sub={seconds(res.elapsed)}
              actions={
                <>
                  <Button icon={FileDown} onClick={async () => { const p = await saveDialog({ defaultPath: `efcam_${res.data.start}.json`, filters: [{ name: "JSON", extensions: ["json"] }] }); if (p) exportReport(toast, log, "Exported sentence JSON", invoke("export_syntax", { path: p, data: res.data })); }}>JSON…</Button>
                  <Button icon={FileDown} onClick={async () => { const p = await saveDialog({ defaultPath: `efcam_${res.data.start}.dot`, filters: [{ name: "Graphviz DOT", extensions: ["dot"] }] }); if (p) exportReport(toast, log, "Exported sentence DOT", invoke("export_syntax", { path: p, data: res.data })); }}>DOT…</Button>
                </>
              }>
              <div className="row" style={{ gap: 6, marginBottom: 16 }}>
                <Chip tone={d.roots.length === 1 ? "pos" : "warn"}>{d.roots.length} root{d.roots.length === 1 ? "" : "s"}</Chip>
                <Chip tone={d.undefined ? "warn" : undefined}>{d.undefined} undefined</Chip>
                <Chip tone={d.invalid_heads.length ? "neg" : undefined}>{d.invalid_heads.length} invalid heads</Chip>
                <Chip tone={d.cycle_nodes.length ? "neg" : undefined}>{d.cycle_nodes.length} cycles</Chip>
                <Chip tone={d.sequential ? "pos" : "warn"}>{d.sequential ? "ids sequential" : "ids not sequential"}</Chip>
              </div>
              <ArcDiagram tokens={res.data.tokens} hover={hover} setHover={setHover} />
              {d.undefined > 0 && <div style={{ marginTop: 12 }}><Notice tone="info">Dashed or missing arcs are <code>__UNDEF__</code> in the corpus. They are kept undefined, never guessed.</Notice></div>}
            </Card>
            <Card flush title="Token table" sub="Text alternative to the diagram">
              <div className="table-wrap" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <table className="table">
                  <thead><tr><th className="num">id</th><th>Word</th><th>POS</th><th>Lemma</th><th className="num">Head</th><th>Relation</th><th className="num">Position</th></tr></thead>
                  <tbody>
                    {res.data.tokens.map((t, i) => (
                      <tr key={t.id + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} aria-selected={hover === i}>
                        <td className="num">{t.id}</td><td>{t.word}</td><td className="mono">{t.pos}</td><td className="muted">{t.lemma}</td>
                        <td className="num">{t.head}</td><td className="mono" style={{ color: t.rel === "__UNDEF__" ? "var(--text-3)" : undefined }}>{t.rel}</td><td className="num">{thousands(t.position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <Card><EmptyState icon={Network} title="No sentence loaded">Enter an EFCAM token position. The whole sentence containing it is decoded (max 255 tokens) and checked for one root, cycles and undefined edges.</EmptyState></Card>
        )}
      </div>
    </div>
  );
}
