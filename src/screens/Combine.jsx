import { describeFilter, describeFilters, filtersOf } from "../lib/filters.js";
import { FilterEditor } from "../components/FilterEditor.jsx";
import { Flag } from "../components/Flag.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { describeFollowers } from "../lib/sequence.js";
import { TerminalBlock } from "../components/TerminalBlock.jsx";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Code2, Combine, Download, FileDown, Filter, FolderOpen, Lightbulb, NotebookPen, Play, Plus, Save, Search as SearchIcon, Shuffle, Trash2, Workflow as WorkflowIcon, Scale,
} from "lucide-react";
import { useApp, EMPTY_QUERY } from "../state/store.jsx";
import { invoke, openDialog, saveDialog, JSON_FILTERS } from "../lib/ipc.js";
import { Button, Card, Checkbox, Dialog, EmptyState, Field, ICON, Input, Notice, Segmented, Select, Chip } from "../components/ui.jsx";
import { QueryBuilder, corpusOptions, fieldOptions, useCqpPreview } from "../components/QueryBuilder.jsx";
import { Kwic } from "../components/Kwic.jsx";
import { BarCell, SERIES } from "../components/charts.jsx";
import { exportReport } from "../lib/exportReport.js";
import { perMillion, rate, safeFileStem, seconds, thousands } from "../lib/format.js";
import { corpusColor, orderedCorpora, isSearchable } from "../nav.js";
import { hasQuery, queryLabel } from "../lib/query.js";
import { Rate, Size, UnitLabel, useUnits } from "../components/Units.jsx";

const planKey = (w) => JSON.stringify({ c: w.corpus, s: w.steps });
const KIND_ICON = { search: SearchIcon, refine: Filter, combine: Combine };

export const DELIVER_EXAMPLE = {
  corpus: "BNC-BABY",
  steps: [{ kind: "search", query: { field: "lexeme", value: "deliver", ignore_case: false, second_field: "class", second_value: "ADV", gap: 0, sentence_only: true } }],
};

function describe(s, i) {
  if (s.kind === "search") {
    const q = s.query;
    if (q.manual) return `Find ${queryLabel(q, 80)}${describeFilters(q).map((d) => `, where ${d}`).join("")}`;
    return `Find ${q.value ? `${q.field} “${q.value}”` : "any word"}${q.ignore_case ? " (any case)" : ""}${describeFollowers(q).map((d) => `, ${d}`).join("")}${q.sentence_only ? ", same sentence" : ""}${describeFilters(q).map((d) => `, where ${d}`).join("")}`;
  }
  if (s.kind === "refine")
    return `${s.mode === "exclude" ? "Remove" : "Keep only"} matches from step ${s.source} whose ${s.anchor === "matchend" ? "last" : "first"} token has ${s.field} = “${s.value}”${s.ignore_case ? " (any case)" : ""}`;
  return `${s.method === "union" ? "Pool" : s.method === "intersection" ? "Keep spans found by both" : "Take step " + s.left + " minus"} ${s.method === "difference" ? `step ${s.right}` : `steps ${s.left} and ${s.right}`} (exact match spans)`;
}

function StepEditor({ open, kind, corpus, count, initial, onClose, onSave }) {
  const { info } = useApp();
  const ci = info?.corpora?.[corpus];
  const [q, setQ] = useState({ ...EMPTY_QUERY, corpus });
  const [r, setR] = useState({ source: 1, mode: "keep", field: "pos", value: "", anchor: "match", ignore_case: false });
  const [c, setC] = useState({ left: 1, right: 2, method: "union" });
  useEffect(() => {
    if (!open) return;
    if (kind === "search") setQ({ ...EMPTY_QUERY, ignore_case: false, ...(initial?.query || {}), corpus });
    if (kind === "refine") setR({ source: count, mode: "keep", field: "pos", value: "", anchor: "match", ignore_case: false, ...(initial || {}) });
    if (kind === "combine") setC({ left: Math.max(1, count - 1), right: count, method: "union", ...(initial || {}) });
  }, [open, kind, initial, count, corpus]);
  const steps = Array.from({ length: count }, (_, i) => [i + 1, `Step ${i + 1}`]);
  const save = () => {
    if (kind === "search") {
      const { corpus: _c, ...query } = q;
      onSave({ kind, query: { ...query, gap: Number(query.gap || 0) } });
    } else if (kind === "refine") onSave({ kind, ...r, source: Number(r.source) });
    else onSave({ kind, ...c, left: Number(c.left), right: Number(c.right) });
  };
  const valid = kind === "search" ? hasQuery(q) : kind === "refine" ? !!r.value && count >= 1 : count >= 2;
  const title = { search: "Search step", refine: "Keep or remove matches", combine: "Combine two results" }[kind];
  return (
    <Dialog open={open} onClose={onClose} wide title={title}
      text={kind === "search" ? "Finds matches in the workflow's corpus." : kind === "refine" ? "Filters an earlier step by an annotation on its first or last matched token." : "Set operations compare exact matched token spans — not documents or sentences."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!valid}>{initial ? "Update step" : "Add step"}</Button></>}>
      <div className="dialog__body">
        {kind === "search" && <QueryBuilder query={q} onChange={setQ} showCorpus={false} onSubmit={() => valid && save()} idPrefix="wf" allowCqp />}
        {kind === "refine" && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="form-grid">
              <Field label="From step"><Select value={r.source} options={steps} onChange={(e) => setR({ ...r, source: e.target.value })} /></Field>
              <Field label="Action"><Segmented value={r.mode} onChange={(v) => setR({ ...r, mode: v })} options={[["keep", "Keep matching"], ["exclude", "Remove matching"]]} /></Field>
            </div>
            <div className="form-grid">
              <Field label="Look at"><Select value={r.anchor} options={[["match", "First token"], ["matchend", "Last token"]]} onChange={(e) => setR({ ...r, anchor: e.target.value })} /></Field>
              <Field label="Attribute"><Select value={r.field} options={fieldOptions(ci)} onChange={(e) => setR({ ...r, field: e.target.value })} /></Field>
              <Field label="Value"><Input value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} placeholder="e.g. NN1" spellCheck={false} maxLength={120} /></Field>
            </div>
            <Checkbox label="Ignore case (word, lemma and headword only)" checked={r.ignore_case} onChange={(v) => setR({ ...r, ignore_case: v })} />
            {["BNC", "BNC-BABY"].includes(corpus) && r.field === "lemma" && !r.value.includes("_") && (
              <Notice tone="warn">BNC lemma values look like <code>disaster_SUBST</code>. Use “All forms (lexeme)” for an ordinary headword.</Notice>
            )}
          </div>
        )}
        {kind === "combine" && (
          <div className="form-grid">
            <Field label="Left"><Select value={c.left} options={steps} onChange={(e) => setC({ ...c, left: e.target.value })} /></Field>
            <Field label="Operation"><Select value={c.method} options={[["union", "Union — pool both"], ["intersection", "Intersection — in both"], ["difference", "Difference — left minus right"]]} onChange={(e) => setC({ ...c, method: e.target.value })} /></Field>
            <Field label="Right"><Select value={c.right} options={steps} onChange={(e) => setC({ ...c, right: e.target.value })} /></Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Builder() {
  const { info, workflow: wf, setWorkflow, run, toast, log, busy, evidence, setEvidence, setEvidenceDirty, setScreen, query, search } = useApp();
  const [editor, setEditor] = useState(null); // { kind, index? }
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("results");
  const [pageSize, setPageSize] = useState(25);
  const [sampleSize, setSampleSize] = useState(50);
  const [seed, setSeed] = useState(42);
  const [groupField, setGroupField] = useState("pos");
  const [groupPos, setGroupPos] = useState("first");
  const [explain, setExplain] = useState(null);
  const ci = info?.corpora?.[wf.corpus];
  const key = planKey(wf);
  const res = wf.result && wf.result.planKey === key ? wf.result : null;
  const plan = { corpus: wf.corpus, steps: wf.steps };

  const update = (patch) => setWorkflow((w) => ({ ...w, ...patch, result: null })); // F7: edits clear stale results
  useEffect(() => setExplain(null), [key]);

  const runIt = async (m = mode, offset = 0) => {
    const request = {
      plan, mode: m, offset: m === "sample" ? 0 : offset, limit: m === "sample" ? sampleSize : pageSize, context: 4,
      seed: m === "sample" ? Number(seed) : null, group_field: groupField, group_position: groupPos,
    };
    const out = await run(m === "group" ? "Grouping workflow results" : m === "sample" ? "Sampling across all matches" : "Running workflow", "run_workflow", { request }, { retry: () => runIt(m, offset) });
    if (!out) return;
    setWorkflow((w) => (planKey(w) === key ? { ...w, result: { planKey: key, request, data: out.data, elapsed: out.elapsed_seconds, cached: out.cached } } : w));
    log({ label: `Workflow on ${wf.corpus} (${wf.steps.length} steps, ${m})`, detail: `${thousands(out.data.total)} spans · ${seconds(out.elapsed_seconds)}` });
  };

  const showPreview = async () => {
    try {
      setPreview(await invoke("compile_workflow_plan", { plan }));
    } catch (e) {
      toast(e.message, "warning");
    }
  };

  const addStep = (step) => {
    const steps = [...wf.steps];
    if (editor.index != null) steps[editor.index] = step;
    else steps.push(step);
    update({ steps });
    setEditor(null);
  };
  const removeStep = (i) => {
    const referenced = wf.steps.some((s, j) => j > i && ((s.kind === "refine" && s.source >= i + 1) || (s.kind === "combine" && (s.left >= i + 1 || s.right >= i + 1))));
    if (referenced) return toast("A later step uses this result. Remove or edit the later step first.", "warning");
    update({ steps: wf.steps.filter((_, j) => j !== i) });
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= wf.steps.length) return;
    const steps = [...wf.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    const bad = steps.some((s, k) => (s.kind === "refine" && s.source > k) || (s.kind === "combine" && (s.left > k || s.right > k)));
    if (bad) return toast("Steps can only use results from earlier steps.", "warning");
    update({ steps });
  };

  const counts = Object.fromEntries((res?.data?.step_counts || []).map((c) => [c.step, c.matches]));
  const groups = res?.data?.groups;
  const rows = res?.data?.results;
  const gmax = Math.max(1, ...(groups || []).map((g) => g.count));

  return (
    <div className="stack">
      <Card
        title="Plan"
        sub="Up to 12 validated steps. Each step can reuse any earlier result."
        actions={
          <>
            <Button variant="ghost" icon={FolderOpen} onClick={async () => { const p = await openDialog({ filters: JSON_FILTERS }); if (!p) return; try { const loaded = await invoke("workflow_load", { path: p }); setWorkflow((w) => ({ ...w, corpus: loaded.corpus, steps: loaded.steps, result: null })); toast("Workflow loaded.", "positive"); } catch (e) { toast(e.message, "negative"); } }}>Open…</Button>
            <Button variant="ghost" icon={Save} disabled={!wf.steps.length} onClick={async () => { const p = await saveDialog({ defaultPath: "workflow.json", filters: JSON_FILTERS }); if (p) exportReport(toast, log, "Saved workflow", invoke("workflow_save", { path: p, plan })); }}>Save…</Button>
            <Button icon={Code2} onClick={showPreview} disabled={!wf.steps.length}>Preview CQP</Button>
          </>
        }
      >
        <div className="row" style={{ gap: 16, marginBottom: 16 }}>
          <Field label="Corpus" htmlFor="wf-corpus" style={{ minWidth: 220 }}>
            <Select id="wf-corpus" value={wf.corpus} options={corpusOptions(info)} onChange={(e) => (wf.steps.length ? toast("Clear the steps before switching corpus — attributes differ between corpora.", "warning") : update({ corpus: e.target.value }))} />
          </Field>
          <span className="spacer" />
          {!wf.steps.length && (
            <>
              <Button variant="ghost" icon={Lightbulb} onClick={() => update({ corpus: DELIVER_EXAMPLE.corpus, steps: DELIVER_EXAMPLE.steps })}>Example: adverbs after “deliver”</Button>
              {search && <Button variant="ghost" icon={SearchIcon} onClick={() => { const { corpus, ...q } = search.request; update({ corpus, steps: [{ kind: "search", query: { field: q.field, value: q.value, regex: q.regex, ignore_case: q.ignore_case, second_field: q.second_field, second_value: q.second_value, gap: q.gap, next: q.next || [], sentence_only: q.sentence_only, meta_attr: q.meta_attr, meta_value: q.meta_value, filters: q.filters || [], manual: !!q.manual, cqp: q.cqp || "" } }] }); }}>Start from current search</Button>}
            </>
          )}
        </div>
        {wf.steps.length ? (
          <ol className="steps" style={{ margin: "0 -24px", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
            {wf.steps.map((s, i) => {
              const I = KIND_ICON[s.kind];
              return (
                <li className="step" key={i}>
                  <span className="step__n">{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="step__kind row" style={{ gap: 6 }}><I {...ICON} size={13} aria-hidden="true" />{s.kind}</div>
                    <div className="step__desc">{describe(s, i)}</div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap", gap: 2 }}>
                    <span className="step__count" style={{ minWidth: 96, marginRight: 8 }} title="Matches after this step">{counts[i + 1] != null ? `${thousands(counts[i + 1])} spans` : "—"}</span>
                    <Button variant="ghost" icon={ArrowUp} aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} />
                    <Button variant="ghost" icon={ArrowDown} aria-label={`Move step ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === wf.steps.length - 1} />
                    <Button variant="ghost" onClick={() => setEditor({ kind: s.kind, index: i })}>Edit</Button>
                    <Button variant="ghost" icon={Trash2} aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(i)} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState icon={WorkflowIcon} title="No steps yet">Start with a search, then keep or remove matches by annotation, or combine two results. Every step's match count is shown after a run.</EmptyState>
        )}
        <div className="card__foot">
          <Button icon={Plus} onClick={() => setEditor({ kind: "search" })} disabled={wf.steps.length >= 12}>Search step</Button>
          <Button icon={Filter} onClick={() => setEditor({ kind: "refine" })} disabled={!wf.steps.length || wf.steps.length >= 12}>Keep / remove</Button>
          <Button icon={Combine} onClick={() => setEditor({ kind: "combine" })} disabled={wf.steps.length < 2 || wf.steps.length >= 12}>Combine</Button>
          <span className="spacer" />
          {wf.steps.length > 0 && <Button variant="ghost" icon={Trash2} onClick={() => { const before = wf.steps; update({ steps: [] }); toast(`Cleared ${before.length} step${before.length === 1 ? "" : "s"}.`, "neutral", 8000, { label: "Undo", onClick: () => update({ steps: before }) }); }}>Clear</Button>}
        </div>
      </Card>

      {wf.steps.length > 0 && (
        <Card title="Run" sub="Read-only; one CQP process per run, empty branches handled safely"
          actions={<Button variant="primary" icon={Play} onClick={() => runIt(mode, 0)} disabled={!!busy}>{mode === "group" ? "Count" : mode === "sample" ? "Sample" : "Run workflow"}</Button>}>
          <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
            <Field label="Show">
              <Segmented value={mode} onChange={setMode} options={[["results", "Matches"], ["group", "Counts"], ["sample", "Random sample"]]} />
            </Field>
            {mode === "results" && (
              <Field label="Page size" htmlFor="wf-ps"><Select id="wf-ps" value={pageSize} options={[[25, "25"], [50, "50"], [100, "100"]]} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: 100 }} /></Field>
            )}
            {mode === "group" && (
              <>
                <Field label="Count by" htmlFor="wf-gf"><Select id="wf-gf" value={groupField} options={fieldOptions(ci).filter(([f]) => ["word", "lexeme", "pos", "class", "lemma", "hw", "rel", "usas"].includes(f))} onChange={(e) => setGroupField(e.target.value)} style={{ minWidth: 190 }} /></Field>
                <Field label="Which token"><Segmented value={groupPos} onChange={setGroupPos} options={[["first", "First"], ["last", "Last"], ["before", "Before"], ["after", "After"]]} /></Field>
              </>
            )}
            {mode === "sample" && (
              <>
                <Field label="Examples" htmlFor="wf-n"><Input id="wf-n" mono type="number" min={1} max={150} value={sampleSize} onChange={(e) => setSampleSize(Math.max(1, Math.min(150, Number(e.target.value) || 1)))} style={{ width: 100 }} /></Field>
                <Field label="Seed" htmlFor="wf-seed" hint="Same seed → same sample"><Input id="wf-seed" mono type="number" min={0} max={2147483647} value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 140 }} /></Field>
              </>
            )}
          </div>
        </Card>
      )}

      {res && (
        <Card flush
          title={<><strong>{thousands(res.data.total)}</strong> matching spans</>}
          sub={<>{wf.corpus} · <Rate count={res.data.total} corpus={wf.corpus} /> <UnitLabel corpora={[wf.corpus]} /> · {res.data.sampling_method}{res.data.seed != null ? ` (seed ${res.data.seed})` : ""} · {seconds(res.elapsed)}</>}
          actions={
            <>
              <Button variant="ghost" icon={Lightbulb} onClick={async () => setExplain(await invoke("explain_workflow_result", { plan, total: res.data.total }).catch((e) => e.message))}>Explain</Button>
              {rows && <Button variant="ghost" icon={NotebookPen} disabled={!rows.length} onClick={async () => { const r = await invoke("evidence_add", { notebook: evidence, corpus: wf.corpus, rows, query: plan }).catch((e) => toast(e.message, "negative")); if (r) { setEvidence(r.rows); setEvidenceDirty(true); toast(`Added ${r.added} examples to the evidence notebook.`, "positive"); } }}>Add to evidence</Button>}
              <Button icon={FileDown} onClick={async () => { const p = await saveDialog({ defaultPath: `${safeFileStem(wf.corpus)}_workflow_${res.request.mode}.csv` }); if (p) exportReport(toast, log, "Exported workflow view", invoke("export_workflow_view", { path: p, plan, result: res.data })); }}>Export view…</Button>
              <Button icon={Download} disabled={!!busy || !res.data.total} onClick={async () => { const p = await saveDialog({ defaultPath: `${safeFileStem(wf.corpus)}_workflow_all.csv` }); if (p) exportReport(toast, log, "Exported workflow (≤5,000)", run("Exporting up to 5,000 spans", "export_workflow_all", { path: p, plan })); }}>Export up to 5,000…</Button>
            </>
          }
        >
          {explain && <div style={{ padding: "0 24px 16px" }}><Notice tone="info">{explain}</Notice></div>}
          <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {groups ? (
              groups.length ? (
                <div tabIndex={0} role="region" aria-label="Workflow counts" className="table-wrap" style={{ "--table-max": "520px" }}>
                  <table className="table">
                    <thead><tr><th>Value</th><th>Meaning</th><th style={{ width: "26%" }}><span className="sr-only">Share</span></th><th className="num">Count</th></tr></thead>
                    <tbody>{groups.map((g, i) => (<tr key={g.value + i}><td className="mono">{g.value}</td><td className="muted">{g.meaning}</td><td><BarCell value={g.count} max={gmax} color={SERIES[i % SERIES.length]} /></td><td className="num">{thousands(g.count)}</td></tr>))}</tbody>
                  </table>
                </div>
              ) : <EmptyState title="No values">The workflow produced no matches to count.</EmptyState>
            ) : rows?.length ? (
              <Kwic rows={rows} offset={res.request.offset} />
            ) : (
              <EmptyState icon={WorkflowIcon} title="Zero matching spans">Every step completed; the final result is empty. Check the per-step counts above to see where matches disappeared.</EmptyState>
            )}
          </div>
          {res.request.mode === "results" && res.data.total > res.request.limit && (
            <div className="card__foot" style={{ padding: "12px 24px", marginTop: 0 }}>
              <span className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-3)" }}>{thousands(res.request.offset + 1)}–{thousands(res.request.offset + rows.length)} of {thousands(res.data.total)}</span>
              <span className="spacer" />
              <Button disabled={res.request.offset === 0 || !!busy} onClick={() => runIt("results", Math.max(0, res.request.offset - res.request.limit))}>Previous</Button>
              <Button disabled={res.request.offset + rows.length >= res.data.total || !!busy} onClick={() => runIt("results", res.request.offset + res.request.limit)}>Next</Button>
            </div>
          )}
        </Card>
      )}

      <StepEditor open={!!editor} kind={editor?.kind} corpus={wf.corpus} count={editor?.index != null ? editor.index : wf.steps.length} initial={editor?.index != null ? wf.steps[editor.index] : null} onClose={() => setEditor(null)} onSave={addStep} />
      <Dialog open={!!preview} onClose={() => setPreview(null)} wide title="Generated CQP" text="Validated, read-only commands. Shown for inspection and reproducibility; it cannot be edited here." footer={<Button onClick={() => setPreview(null)}>Close</Button>}>
        {preview && (
          <div className="dialog__body">
            <ul className="prose" style={{ listStyle: "none", padding: 0 }}>{preview.summaries.map((s) => <li key={s}>{s}</li>)}</ul>
            <pre className="code">{preview.script}</pre>
            <TerminalBlock op="workflow" request={{ plan, mode, offset: 0, limit: mode === "sample" ? sampleSize : pageSize, context: 4, seed: mode === "sample" ? Number(seed) : null, group_field: groupField, group_position: groupPos }} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default function CombineScreen() {
  const { workflow } = useApp();
  return (
    <div className="page">
      <PageHeader aside={workflow.corpus} />
      <Builder />
    </div>
  );
}

export { Chip };
