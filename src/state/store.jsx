import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen } from "../lib/ipc.js";
import { useTheme } from "../lib/theme.js";
import { ASK_IDS, canonicalScreen } from "../nav.js";
import { ui } from "../lib/uiState.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const UNIT_KEY = "hapax.rateUnit";
const WORDS_KEY = "hapax.wordCounts";

export const EMPTY_QUERY = {
  corpus: "BROWN-LEGACY", field: "word", value: "", regex: false, ignore_case: true,
  second_field: "word", second_value: "", gap: 0, sentence_only: false, meta_attr: "", meta_value: "", filters: [],
};

/** Stable key of everything that changes a result (F7: stale-result guard). */
export const queryKey = (q) =>
  JSON.stringify([q.corpus, q.field, q.value, !!q.regex, !!q.ignore_case, q.second_field, q.second_value, Number(q.gap || 0), !!q.sentence_only, q.meta_attr, q.meta_value, (q.next || []).map((t) => [t.field, t.value, Number(t.gap || 0), !!t.optional]), (q.filters || []).map((f) => [f.attr, f.op, f.value, f.from ?? null, f.to ?? null]), !!q.manual, q.manual ? q.cqp || "" : ""]);

let toastSeq = 0;
/** Filter presets lived in localStorage before 1.x; copy them into preferences.json once. */
const LEGACY_PRESETS = "hapax.filterPresets";
async function migratePresets(p) {
  let old;
  try { old = JSON.parse(localStorage.getItem(LEGACY_PRESETS) || "null"); } catch { old = null; }
  if (!old || typeof old !== "object") return p;
  let all = p.filter_presets || {};
  let failed = false;
  for (const [corpus, list] of Object.entries(old)) {
    if (!Array.isArray(list) || !list.length) continue;
    const have = all[corpus] || [];
    const merged = [...have, ...list.filter((x) => !have.some((h) => h.name === x?.name))];
    try { all = await invoke("set_filter_presets", { corpus, presets: merged }); }
    catch { failed = true; } // unknown corpus or a filter it no longer accepts: keep the local copy
  }
  if (!failed) try { localStorage.removeItem(LEGACY_PRESETS); } catch { /* ignore */ }
  return { ...p, filter_presets: all };
}

const DRAFT_KEY = "hapax.evidence.draft";
/** The query form as last left (run or not), restored on the next start. */
const QUERY_KEY = "hapax.query.draft";
const readQueryDraft = () => {
  try {
    const q = JSON.parse(localStorage.getItem(QUERY_KEY) || "null");
    return q && typeof q === "object" && typeof q.corpus === "string" ? q : null;
  } catch { return null; }
};

export function AppProvider({ children }) {
  const [info, setInfo] = useState(null);
  const [corpusCheck, setCorpusCheck] = useState(null); // last registry check: { at, added, missing, changed }
  const [prefs, setPrefs] = useState(null);
  const [connection, setConnection] = useState({ connected: false });
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(null); // { label, startedAt }
  const [lastRun, setLastRun] = useState(null); // { label, elapsed, cached }
  const [toasts, setToasts] = useState([]);
  // Start where the user left off (per viewer); older ids are accepted everywhere.
  const [screen, setScreenRaw] = useState(() => canonicalScreen(ui.get("screen", "home")));
  // Query panel shows "Ask a question" (the former Guided search page).
  const [asking, setAsking] = useState(false);
  const setScreen = useCallback((id) => {
    const raw = typeof id === "function" ? id(screen) : id;
    if (ASK_IDS.has(raw)) setAsking(true);
    setScreenRaw(canonicalScreen(raw));
  }, [screen]);
  useEffect(() => {
    ui.set("screen", screen);
    const [head, view] = screen.split("/");
    if (view) ui.set(`view.${head}`, view);
  }, [screen]);
  // Page guides: closed by default, opened from the top bar.
  const [guideOpen, setGuideOpenRaw] = useState(() => ui.get("guide", false));
  const setGuideOpen = useCallback((v) => setGuideOpenRaw((cur) => { const n = typeof v === "function" ? v(cur) : v; ui.set("guide", n); return n; }), []);
  // Dev builds only: lets UI tests jump straight to a screen.
  if (import.meta.env.DEV && typeof window !== "undefined") window.__hapaxGo = setScreen;
  const [dialog, setDialog] = useState(null); // "connect" | "palette" | null
  const [hostKey, setHostKey] = useState(null);
  const [activity, setActivity] = useState([]); // session log for Overview
  // Recent searches (this computer only): restored from localStorage, newest first.
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cqp.recent") || "[]").slice(0, 20); } catch { return []; }
  });
  const remember = useCallback((q, total) => {
    setRecent((list) => {
      const key = queryKey(q);
      const next = [{ query: q, total, at: new Date().toISOString() }, ...list.filter((r) => queryKey(r.query) !== key)].slice(0, 20);
      try { localStorage.setItem("cqp.recent", JSON.stringify(next)); } catch { /* convenience only */ }
      return next;
    });
  }, []);
  const [consoleLog, setConsoleLog] = useState([]);
  const [consoleOpen, setConsoleOpenState] = useState(() => {
    try {
      return localStorage.getItem("cqp.console") === "open";
    } catch {
      return false;
    }
  });
  const setConsoleOpen = useCallback((v) => {
    setConsoleOpenState((cur) => {
      const next = typeof v === "function" ? v(cur) : v;
      try {
        localStorage.setItem("cqp.console", next ? "open" : "closed");
      } catch {
        /* convenience only */
      }
      return next;
    });
  }, []);
  const clearConsole = useCallback(() => {
    invoke("clear_console_log").catch(() => {});
    setConsoleLog([]);
  }, []);

  // ---- session results (kept across screen switches, like v3 tabs) ----
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [search, setSearch] = useState(null); // { key, request, data, interpretation }
  const [analysis, setAnalysis] = useState({ frequencies: null, collocates: null, lexicon: null });
  const [evidence, setEvidence] = useState([]);
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  // Unsaved notebook draft, kept on this computer so closing the app does not lose judgements.
  // Cleared once the notebook is saved to a file (evidenceDirty false) or emptied.
  const draftReady = useRef(false);
  useEffect(() => {
    if (!draftReady.current) return;
    try {
      if (evidenceDirty && evidence.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), rows: evidence }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* storage full or blocked: the in-window notebook still works */ }
  }, [evidence, evidenceDirty]);
  useEffect(() => {
    if (!draftReady.current) return;
    const t = setTimeout(() => {
      try {
        const blank = !query.value && !query.cqp?.trim() && !(query.filters || []).length && !(query.next || []).length && !query.second_value && !query.meta_value;
        if (blank) localStorage.removeItem(QUERY_KEY);
        else localStorage.setItem(QUERY_KEY, JSON.stringify(query));
      } catch { /* storage blocked: the form simply starts empty next time */ }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);
  // The Combine plan (not its results) is kept for this viewer, so a plan survives a restart.
  const [workflow, setWorkflow] = useState(() => {
    const kept = ui.get("workflow.plan", null);
    return { corpus: kept?.corpus || "BNC-BABY", steps: Array.isArray(kept?.steps) ? kept.steps : [], result: null, request: null, mode: "results" };
  });
  useEffect(() => { ui.set("workflow.plan", { corpus: workflow.corpus, steps: workflow.steps }); }, [workflow.corpus, workflow.steps]);

  const persistTheme = useCallback((t) => {
    setPrefs((p) => {
      if (!p) return p;
      const next = { ...p, theme: t };
      invoke("save_preferences", { preferences: next }).catch(() => {});
      return next;
    });
  }, []);
  const theme = useTheme(persistTheme);

  /** `action` = { label, onClick } adds one button (e.g. Undo) that also dismisses the toast. */
  const toast = useCallback((message, tone = "neutral", ttl = 5200, action = null) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, message, tone, action }]);
    if (ttl) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    return id;
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const log = useCallback((entry) => setActivity((a) => [{ at: new Date(), ...entry }, ...a].slice(0, 12)), []);

  // ---- bootstrap ----
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d?.rows?.length) {
        setEvidence(d.rows);
        setEvidenceDirty(true);
        const when = new Date(d.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        toast(`Restored an unsaved evidence notebook (${d.rows.length} examples, last changed ${when}).`, "neutral", 12000, {
          label: "Discard",
          onClick: () => {
            setEvidence([]);
            setEvidenceDirty(false);
            toast("Discarded the restored notebook.", "neutral", 8000, { label: "Undo", onClick: () => { setEvidence(d.rows); setEvidenceDirty(true); } });
          },
        });
      }
    } catch { /* unreadable draft: ignore */ }
    draftReady.current = true;
    (async () => {
      try {
        const [i, p, s] = await Promise.all([invoke("get_app_info"), invoke("get_preferences"), invoke("ssh_status")]);
        setInfo(i);
        setPrefs(await migratePresets(p));
        setConnection(s);
        const kept = readQueryDraft();
        setQuery((q) =>
          kept && i.corpora[kept.corpus]
            ? { ...EMPTY_QUERY, ...kept }
            : { ...q, corpus: i.corpora[p.corpus] ? p.corpus : q.corpus });
        if (p.theme && ["dark", "light", "system"].includes(p.theme) && !localStorage.getItem("cqp.theme")) theme.setPref(p.theme);
        if (s.connected) discover(); // already connected (e.g. after a reload): re-check the corpus list
      } catch (e) {
        toast(e.message, "negative", 0);
      }
    })();
    invoke("get_console_log").then(setConsoleLog).catch(() => {});
    const offs = [
      listen("console://entry", ({ payload }) =>
        setConsoleLog((log) => {
          const i = log.findIndex((e) => e.id === payload.id);
          if (i === -1) return [...log, payload].slice(-300);
          const next = log.slice();
          next[i] = payload;
          return next;
        })
      ),
      listen("ssh://connection", ({ payload }) => setConnection(payload)),
      listen("ssh://host-key-prompt", ({ payload }) => setHostKey(payload)),
    ];
    return () => offs.forEach((p) => p.then((f) => f()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pending, setPending] = useState(null); // { label, retry } refused for lack of a connection
  useEffect(() => { if (dialog !== "connect" && !connection.connected) setPending(null); }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const busyRef = useRef(null);
  busyRef.current = busy;

  /**
   * Run one backend operation with the shared busy/timer/error handling.
   * Returns `undefined` on error (already reported) so callers stay simple.
   */
  const run = useCallback(
    async (label, cmd, args, { quiet = false, retry = null } = {}) => {
      if (busyRef.current) {
        toast("Another operation is already running", "warning");
        return undefined;
      }
      const started = performance.now();
      busyRef.current = { label, startedAt: started }; // synchronous, so back-to-back runs are not refused
      setBusy({ label, startedAt: started });
      try {
        const out = await invoke(cmd, args);
        if (out && typeof out === "object" && "elapsed_seconds" in out) {
          setLastRun({ label, elapsed: out.elapsed_seconds, cached: out.cached });
        }
        return out;
      } catch (e) {
        if (e.kind === "cancelled") toast("Request stopped. The server may finish the job in the background.", "warning");
        else if (e.kind === "not_connected") {
          // Remember what was refused so it can run as soon as the user has signed in.
          setPending(retry ? { label, retry } : null);
          setDialog("connect");
        } else if (!quiet) toast(e.message, e.kind === "validation" ? "warning" : "negative", 9000);
        if (quiet) throw e;
        return undefined;
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [toast]
  );

  const cancel = useCallback(() => invoke("cancel_request").catch(() => {}), []);

  /** Ask the server which corpora exist now and adopt that list. */
  const discover = useCallback(async () => {
    try {
      const d = await invoke("discover_corpora");
      setInfo((i) => (i ? { ...i, corpora: d.corpora } : i));
      setCorpusCheck({ at: new Date(), added: d.added, missing: d.missing, changed: d.changed });
      setQuery((q) => {
        if (d.corpora[q.corpus]?.available !== false) return q;
        const first = Object.keys(d.corpora).find((c) => d.corpora[c].available && d.corpora[c].encoding !== "<unsupported>");
        return first ? { ...q, corpus: first, meta_attr: "", meta_value: "", filters: [] } : q;
      });
      const parts = [];
      if (d.added.length) parts.push(`new on the server: ${d.added.join(", ")}`);
      if (d.missing.length) parts.push(`not available: ${d.missing.join(", ")}`);
      if (d.changed.length) parts.push(`encoding changed: ${d.changed.join(", ")}`);
      if (parts.length) toast(`Corpus list updated — ${parts.join(" · ")}`, d.missing.length ? "warning" : "neutral", 9000);
    } catch (e) {
      toast(`Could not check which corpora are available (${e.message}). Using the built-in list.`, "warning", 9000);
    }
  }, [toast]);

  const connect = useCallback(
    async (args) => {
      try {
        const res = await run("Connecting to university SSH", "ssh_connect", { args }, { quiet: true });
        setEngine(res.engine);
        setConnection({ connected: true, host: res.host, user: res.user, port: res.port });
        setSearch(null);
        log({ kind: "connect", label: `Connected ${res.user}@${res.host}`, detail: `CQP ${res.engine}` });
        toast(`Connected to ${res.host} · CQP ${res.engine}`, "positive");
        if (res.warning) toast(`Connected, but the password was not saved: ${res.warning}`, "warning", 9000);
        // The backend persisted host/user/port; adopt its copy so a later
        // save_preferences (e.g. a theme change) cannot write stale values back.
        invoke("get_preferences").then(setPrefs).catch(() => {});
        discover();
        setPending((p) => {
          if (p) setTimeout(p.retry, 0); // after this run() has released the busy guard
          return null;
        });
        return res;
      } catch (e) {
        throw e;
      }
    },
    [run, toast, log, discover]
  );

  const disconnect = useCallback(async () => {
    try {
      const s = await invoke("ssh_disconnect");
      setConnection(s);
      setEngine(null);
      toast("Disconnected", "neutral");
    } catch (e) {
      toast(e.message, "warning");
    }
  }, [toast]);

  const answerHostKey = useCallback(async (trust) => {
    const pending = hostKey;
    setHostKey(null);
    if (pending) await invoke("answer_host_key", { requestId: pending.request_id, trust }).catch(() => {});
  }, [hostKey]);

  const corpusInfo = useCallback((name) => info?.corpora?.[name], [info]);

  // ---- rates per million tokens or per million words (click a rate or size to switch) ----
  // Word counts (tokens with a letter or digit) are measured once per corpus on
  // the server and kept on this computer, keyed by the corpus size.
  const [unit, setUnit] = useState(() => { try { return localStorage.getItem(UNIT_KEY) === "words" ? "words" : "tokens"; } catch { return "tokens"; } });
  const [wordCounts, setWordCounts] = useState(() => { try { return JSON.parse(localStorage.getItem(WORDS_KEY) || "{}"); } catch { return {}; } });
  const wanted = useRef(new Set());
  const failedWords = useRef(new Set());
  const [wantTick, setWantTick] = useState(0);
  const toggleUnit = useCallback(() => setUnit((u) => {
    const next = u === "words" ? "tokens" : "words";
    try { localStorage.setItem(UNIT_KEY, next); } catch { /* per-viewer convenience only */ }
    return next;
  }), []);
  const wordsOf = useCallback((corpus) => {
    const w = wordCounts[corpus];
    const t = info?.corpora?.[corpus]?.tokens;
    return w && (!t || w.tokens === t) ? w.words : null;
  }, [wordCounts, info]);
  const needWords = useCallback((list) => {
    let added = false;
    for (const c of list) if (c && !wanted.current.has(c)) { wanted.current.add(c); added = true; }
    if (added) setWantTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (unit !== "words" || busy || !connection.connected || !info) return;
    const next = [...wanted.current].find((c) => info.corpora[c] && wordsOf(c) == null && !failedWords.current.has(c) && info.corpora[c].available !== false && info.corpora[c].encoding !== "<unsupported>");
    if (!next) return;
    run(`Counting words in ${next} (once)`, "word_count", { corpus: next }, { quiet: true })
      .then((out) => {
        if (!out) return;
        setWordCounts((m) => {
          const n = { ...m, [next]: { words: out.data.words, tokens: info.corpora[next].tokens } };
          try { localStorage.setItem(WORDS_KEY, JSON.stringify(n)); } catch { /* recounted next time */ }
          return n;
        });
      })
      .catch((e) => { failedWords.current.add(next); toast(`Could not count the words in ${next}: ${e.message}`, "warning", 8000); });
  }, [unit, busy, connection.connected, info, wantTick, wordsOf, run, toast]);

  const value = useMemo(
    () => ({
      info, prefs, setPrefs, connection, engine, busy, lastRun, toasts, toast, dismissToast,
      screen, setScreen, dialog, setDialog, hostKey, answerHostKey, theme,
      run, cancel, connect, disconnect, pending, setPending, corpusInfo, activity, log, recent, remember, corpusCheck, discover,
      consoleLog, consoleOpen, setConsoleOpen, clearConsole,
      query, setQuery, search, setSearch, analysis, setAnalysis,
      evidence, setEvidence, evidenceDirty, setEvidenceDirty, workflow, setWorkflow,
      unit, toggleUnit, wordsOf, needWords, asking, setAsking, guideOpen, setGuideOpen,
    }),
    [info, prefs, connection, engine, busy, lastRun, toasts, toast, dismissToast, screen, dialog, hostKey, answerHostKey, theme,
     run, cancel, connect, disconnect, corpusInfo, activity, log, recent, remember, corpusCheck, discover, consoleLog, consoleOpen, setConsoleOpen, clearConsole, query, search, analysis, evidence, evidenceDirty, workflow, pending, unit, toggleUnit, wordsOf, needWords, asking, guideOpen, setGuideOpen]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
