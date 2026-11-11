import { useEffect, useState } from "react";
import { ArrowRight, Workflow } from "lucide-react";
import { useApp, EMPTY_QUERY } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { Button, Field, Input, Notice, Select } from "./ui.jsx";

/**
 * "Ask a question" in the query panel (formerly the Guided search page):
 * pick a plain-language question; the corpus-specific query is built and
 * previewed, then loaded into Build (or Combine searches when it needs steps).
 * Uses the working corpus of the panel.
 */
export function AskQuestion({ corpus, onUse }) {
  const { setQuery, setSearch, setScreen, setWorkflow, toast, workflow } = useApp();
  const [qs, setQs] = useState({ modes: [], parts: [] });
  const [input, setInput] = useState({ mode: 0, word: "go", alt: "walk", first: "adjective", second: "noun", gap: 0, genre: "Narrative fiction", pos: "noun" });
  const [recipe, setRecipe] = useState(null);
  const [err, setErr] = useState(null);
  const set = (p) => setInput((i) => ({ ...i, ...p }));

  useEffect(() => { invoke("get_guided_questions").then(setQs).catch(() => {}); }, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      invoke("build_guided_recipe", { input: { ...input, corpus, gap: Number(input.gap) || 0 } })
        .then((r) => live && (setRecipe(r), setErr(null)))
        .catch((e) => live && (setRecipe(null), setErr(e.message)));
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [input, corpus]);

  const m = input.mode;
  const needsWord = [0, 1, 3, 4, 5, 6, 7].includes(m);
  const parts = qs.parts.map((p) => [p, p]);
  const use = () => {
    setQuery({ ...EMPTY_QUERY, ...recipe.base });
    setSearch(null);
    onUse?.();
    toast("Question loaded into Build — review it, then press Search.", "neutral");
  };
  const toCombine = () => {
    const steps = recipe.steps || [{ kind: "search", query: Object.fromEntries(Object.entries(recipe.base).filter(([k]) => k !== "corpus")) }];
    setWorkflow((w) => ({ ...w, corpus: recipe.base.corpus, steps, result: null }));
    setScreen("combine");
    if (workflow.steps.length) toast("The previous Combine plan was replaced.", "warning");
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Field label="Question" htmlFor="ask-m">
        <Select id="ask-m" value={m} options={qs.modes.map((q, i) => [i, q])} onChange={(e) => set({ mode: Number(e.target.value) })} />
      </Field>
      <div className="form-grid">
        {needsWord && <Field label="Word" htmlFor="ask-w"><Input id="ask-w" value={input.word} onChange={(e) => set({ word: e.target.value })} spellCheck={false} /></Field>}
        {m === 5 && <Field label="Alternative word" htmlFor="ask-a"><Input id="ask-a" value={input.alt} onChange={(e) => set({ alt: e.target.value })} spellCheck={false} /></Field>}
        {[2, 4].includes(m) && <Field label="First category" htmlFor="ask-f"><Select id="ask-f" value={input.first} options={parts} onChange={(e) => set({ first: e.target.value })} /></Field>}
        {[2, 3].includes(m) && <Field label="Then category" htmlFor="ask-s"><Select id="ask-s" value={input.second} options={parts} onChange={(e) => set({ second: e.target.value })} /></Field>}
        {[2, 3, 4, 8].includes(m) && <Field label="Words in between" hint="0 = directly adjacent" htmlFor="ask-g"><Input id="ask-g" mono type="number" min={0} max={10} value={input.gap} onChange={(e) => set({ gap: e.target.value })} /></Field>}
        {m === 6 && <Field label="Used as" htmlFor="ask-p"><Select id="ask-p" value={input.pos} options={parts} onChange={(e) => set({ pos: e.target.value })} /></Field>}
        {m === 7 && <Field label="Exact genre value" hint="Corpora › Metadata lists the values" htmlFor="ask-ge"><Input id="ask-ge" value={input.genre} onChange={(e) => set({ genre: e.target.value })} /></Field>}
      </div>
      {err && <Notice tone="warn">{err}</Notice>}
      {recipe && (
        <div className="ask__preview">
          <p>{recipe.note}</p>
          <pre className="code">{recipe.preview}</pre>
          {recipe.steps && <Notice tone="info">This question needs several steps, so it opens in Combine searches.</Notice>}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" icon={ArrowRight} disabled={!recipe || !!recipe?.steps} onClick={use}>Use this search</Button>
        <Button icon={Workflow} disabled={!recipe} onClick={toCombine}>Open in Combine searches</Button>
      </div>
    </div>
  );
}
