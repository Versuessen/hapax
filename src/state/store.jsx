import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen } from "../lib/ipc.js";
import { useTheme } from "../lib/theme.js";
import { canonicalScreen } from "../nav.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const EMPTY_QUERY = {
  corpus: "BROWN-LEGACY", field: "word", value: "", regex: false, ignore_case: true,
  second_field: "word", second_value: "", gap: 0, sentence_only: false, meta_attr: "", meta_value: "",
};

/** Stable key of everything that changes a result (F7: stale-result guard). */
export const queryKey = (q) =>
  JSON.stringify([q.corpus, q.field, q.value, !!q.regex, !!q.ignore_case, q.second_field, q.second_value, Number(q.gap || 0), !!q.sentence_only, q.meta_attr, q.meta_value, (q.next || []).map((t) => [t.field, t.value, Number(t.gap || 0), !!t.optional])]);

let toastSeq = 0;

export function AppProvider({ children }) {
  const [info, setInfo] = useState(null);
  const [corpusCheck, setCorpusCheck] = useState(null); // last registry check: { at, added, missing, changed }
  const [prefs, setPrefs] = useState(null);
  const [connection, setConnection] = useState({ connected: false });
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(null); // { label, startedAt }
  const [lastRun, setLastRun] = useState(null); // { label, elapsed, cached }
  const [toasts, setToasts] = useState([]);
  const [screen, setScreenRaw] = useState("home");
  // Accept older screen ids everywhere (in-app jumps, palette, saved links).
  const setScreen = useCallback((id) => setScreenRaw(canonicalScreen(typeof id === "function" ? id(screen) : id)), [screen]);
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
  const [workflow, setWorkflow] = useState({ corpus: "BNC-BABY", steps: [], result: null, request: null, mode: "results" });

  const persistTheme = useCallback((t) => {
    setPrefs((p) => {
      if (!p) return p;
      const next = { ...p, theme: t };
      invoke("save_preferences", { preferences: next }).catch(() => {});
      return next;
    });
  }, []);
  const theme = useTheme(persistTheme);

  const toast = useCallback((message, tone = "neutral", ttl = 5200) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    if (ttl) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    return id;
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const log = useCallback((entry) => setActivity((a) => [{ at: new Date(), ...entry }, ...a].slice(0, 12)), []);

  // ---- bootstrap ----
  useEffect(() => {
    (async () => {
      try {
        const [i, p, s] = await Promise.all([invoke("get_app_info"), invoke("get_preferences"), invoke("ssh_status")]);
        setInfo(i);
        setPrefs(p);
        setConnection(s);
        setQuery((q) => ({ ...q, corpus: i.corpora[p.corpus] ? p.corpus : q.corpus }));
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

  const busyRef = useRef(null);
  busyRef.current = busy;

  /**
   * Run one backend operation with the shared busy/timer/error handling.
   * Returns `undefined` on error (already reported) so callers stay simple.
   */
  const run = useCallback(
    async (label, cmd, args, { quiet = false } = {}) => {
      if (busyRef.current) {
        toast("Another operation is already running", "warning");
        return undefined;
      }
      const started = performance.now();
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
          toast(e.message, "warning");
          setDialog("connect");
        } else if (!quiet) toast(e.message, e.kind === "validation" ? "warning" : "negative", 9000);
        if (quiet) throw e;
        return undefined;
      } finally {
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
        return first ? { ...q, corpus: first, meta_attr: "", meta_value: "" } : q;
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

  const value = useMemo(
    () => ({
      info, prefs, setPrefs, connection, engine, busy, lastRun, toasts, toast, dismissToast,
      screen, setScreen, dialog, setDialog, hostKey, answerHostKey, theme,
      run, cancel, connect, disconnect, corpusInfo, activity, log, recent, remember, corpusCheck, discover,
      consoleLog, consoleOpen, setConsoleOpen, clearConsole,
      query, setQuery, search, setSearch, analysis, setAnalysis,
      evidence, setEvidence, evidenceDirty, setEvidenceDirty, workflow, setWorkflow,
    }),
    [info, prefs, connection, engine, busy, lastRun, toasts, toast, dismissToast, screen, dialog, hostKey, answerHostKey, theme,
     run, cancel, connect, disconnect, corpusInfo, activity, log, recent, remember, corpusCheck, discover, consoleLog, consoleOpen, setConsoleOpen, clearConsole, query, search, analysis, evidence, evidenceDirty, workflow]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
