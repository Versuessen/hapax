import { PageHeader } from "../components/PageHeader.jsx";
import { describeFollowers } from "../lib/sequence.js";
import { useState } from "react";
import { Bookmark, History, Play, Trash2 } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Card, Chip, Dialog, EmptyState } from "../components/ui.jsx";
import { corpusColor } from "../nav.js";

export default function Saved() {
  const { prefs, setPrefs, setQuery, setSearch, setScreen, toast, recent } = useApp();
  const [del, setDel] = useState(null);
  const list = prefs?.saved_searches || [];
  const restore = (s, runNow) => {
    setQuery((q) => ({ ...q, ...s.query }));
    setSearch(null);
    setScreen("search");
    if (runNow) setTimeout(() => window.dispatchEvent(new CustomEvent("cqp:search")), 50);
  };
  return (
    <div className="page">
      <PageHeader aside={`${list.length} saved`} />
      <Card flush title="Saved searches" sub="Stored on this computer. Results are recomputed on the server each time">
        {list.length ? (
          <ul style={{ listStyle: "none", borderTop: "1px solid var(--border-subtle)" }}>
            {list.map((s) => {
              const q = s.query;
              return (
                <li key={s.name} className="step" style={{ gridTemplateColumns: "12px minmax(0,1fr) auto" }}>
                  <span className="dot" style={{ background: corpusColor(q.corpus), color: corpusColor(q.corpus) }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <Chip>{q.corpus}</Chip>
                      <Chip>{q.field || "word"} = {q.value}{q.ignore_case ? " %c" : ""}</Chip>
                      {describeFollowers(q).map((d) => <Chip key={d}>{d}</Chip>)}
                      {q.meta_attr && q.meta_value && <Chip tone="warn">{q.meta_attr} = {q.meta_value}</Chip>}
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <Button variant="ghost" onClick={() => restore(s, false)}>Edit</Button>
                    <Button icon={Play} onClick={() => restore(s, true)}>Run</Button>
                    <Button variant="ghost" icon={Trash2} aria-label={`Delete ${s.name}`} onClick={() => setDel(s.name)} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={Bookmark} title="Nothing saved yet" action={<Button variant="primary" onClick={() => setScreen("search")}>Open search</Button>}>
            Use <strong>Save</strong> on the Search screen (Ctrl+S) to keep a query you want to rerun.
          </EmptyState>
        )}
      </Card>
      <Card flush title="Recent searches" sub="The last 20 searches you ran, newest first" style={{ marginTop: 16 }}>
        {recent?.length ? (
          <ul style={{ listStyle: "none", borderTop: "1px solid var(--border-subtle)" }}>
            {recent.map((r) => {
              const q = r.query;
              return (
                <li key={r.at} className="step" style={{ gridTemplateColumns: "12px minmax(0,1fr) auto" }}>
                  <span className="dot" style={{ background: corpusColor(q.corpus), color: corpusColor(q.corpus) }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <Chip>{q.corpus}</Chip>
                      <Chip>{q.field || "word"} = {q.value}{q.ignore_case ? " %c" : ""}</Chip>
                      {describeFollowers(q).map((d) => <Chip key={d}>{d}</Chip>)}
                      {q.meta_attr && q.meta_value && <Chip tone="warn">{q.meta_attr} = {q.meta_value}</Chip>}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                      {Number(r.total).toLocaleString()} matches · {new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <Button variant="ghost" onClick={() => restore({ query: q }, false)}>Edit</Button>
                    <Button icon={Play} onClick={() => restore({ query: q }, true)}>Run</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={History} title="No searches run yet">Searches you run appear here automatically, on this computer only.</EmptyState>
        )}
      </Card>
      <Dialog open={!!del} onClose={() => setDel(null)} title="Delete saved search?" text={`“${del}” will be removed from preferences.json on this computer.`}
        footer={<><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={async () => { try { const l = await invoke("delete_saved_search", { name: del }); setPrefs((p) => ({ ...p, saved_searches: l })); toast("Saved search deleted.", "neutral"); } catch (e) { toast(e.message, "negative"); } setDel(null); }}>Delete</Button></>} />
    </div>
  );
}
