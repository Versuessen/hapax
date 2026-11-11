import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Monitor, Moon, Square, SquareTerminal, Sun } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { corporaByVariety, corpusFamily, findNav, varietyInfo } from "../nav.js";
import { Flag } from "./Flag.jsx";
import { usePickCorpus } from "./Sidebar.jsx";
import { Button, ICON, Spinner } from "./ui.jsx";
import { seconds } from "../lib/format.js";
import { Size } from "./Units.jsx";

function ThemeMenu() {
  const { theme } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const Current = theme.pref === "system" ? Monitor : theme.resolved === "dark" ? Moon : Sun;
  const opts = [["system", "System", Monitor], ["light", "Light", Sun], ["dark", "Dark", Moon]];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="ghost" icon={Current} aria-label={`Theme: ${theme.pref}`} title="Theme" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="menu" role="menu" style={{ right: 0, top: 38 }}>
          {opts.map(([v, label, I]) => (
            <button
              key={v}
              role="menuitemradio"
              aria-checked={theme.pref === v}
              onClick={() => {
                theme.setPref(v);
                setOpen(false);
              }}
            >
              <I {...ICON} aria-hidden="true" />
              {label}
              {theme.pref === v && <Check {...ICON} size={14} className="menu__check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Closes a popup on outside click or Escape (Escape returns focus to the trigger). */
function useDismiss(open, setOpen, ref, triggerRef) {
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef?.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Working-corpus switcher for the top bar. Shown when the sidebar is a rail
 * (narrow windows, or collapsed by the user), where the corpus list is hidden.
 */
function CorpusSwitcher() {
  const { info, query } = useApp();
  const pick = usePickCorpus();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  useDismiss(open, setOpen, ref, trigger);
  useEffect(() => {
    if (!open) return;
    const m = menu.current;
    (m?.querySelector('[aria-checked="true"]:not(:disabled)') || m?.querySelector("button:not(:disabled)"))?.focus();
  }, [open]);
  const ci = info?.corpora?.[query.corpus];
  if (!info || !ci) return null;
  const onKey = (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = [...menu.current.querySelectorAll("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div ref={ref} className="corpus-switch">
      <button ref={trigger} type="button" className="corpus-switch__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={`Working corpus: ${query.corpus} — ${ci.description}`}>
        <span className="sr-only">Working corpus: </span>
        <Flag variety={ci.variety} note={ci.variety_note} />
        <span className="corpus-switch__name">{query.corpus}</span>
        {ci.tokens ? <span className="mono corpus-switch__size"><Size corpus={query.corpus} bare label={false} /></span> : null}
        <ChevronDown {...ICON} size={14} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} className="menu corpus-switch__menu" role="menu" aria-label="Working corpus" onKeyDown={onKey}>
          {corporaByVariety(info).map((g) => (
            <div key={g.key} role="group" aria-label={g.info.label}>
              <div className="corpus-switch__group" aria-hidden="true"><Flag variety={g.variety} size={14} />{g.info.label}</div>
              {g.corpora.map((c) => {
                const x = info.corpora[c];
                const offline = x.available === false;
                const broken = x.encoding === "<unsupported>";
                return (
                  <button key={c} type="button" role="menuitemradio" aria-checked={c === query.corpus} disabled={offline}
                    title={`${x.description} · ${x.variety_note || varietyInfo(x.variety).label} · ${corpusFamily(c).label}`}
                    onClick={() => { pick(c); setOpen(false); trigger.current?.focus(); }}>
                    <span>{c}</span>
                    <span className="mono corpus-switch__size">{offline ? "offline" : broken ? "n/a" : x.tokens ? <Size corpus={c} bare label={false} /> : "new"}</span>
                    {c === query.corpus ? <Check {...ICON} size={14} className="menu__check" aria-hidden="true" /> : <span className="menu__check" style={{ width: 14 }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusyIndicator() {
  const { busy, cancel, lastRun } = useApp();
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [busy]);
  if (busy) {
    return (
      <div className="row" style={{ gap: 10 }} role="status" aria-live="polite">
        <Spinner label={busy.label} />
        <span className="topbar__hide-narrow" style={{ color: "var(--text-2)", fontSize: "var(--fs-small)" }}>{busy.label}</span>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-mono)" }}>{((now - busy.startedAt) / 1000).toFixed(1)} s</span>
        <Button icon={Square} onClick={cancel} title="Stop request (closes the SSH channel; best effort)">Stop</Button>
      </div>
    );
  }
  if (!lastRun) return null;
  return (
    <span className="mono topbar__hide-narrow" style={{ color: "var(--text-3)", fontSize: "var(--fs-mono)" }} title="Client wall-clock time: SSH round trip, remote execution and parsing — not backend-only speed">
      {seconds(lastRun.elapsed)} · {lastRun.cached ? "cached" : "SSH request"}
    </span>
  );
}

export function Topbar({ corpusSwitcher = false }) {
  const { screen, connection, engine, setDialog, consoleOpen, setConsoleOpen, consoleLog } = useApp();
  const consoleErrors = consoleLog.filter((e) => e.status === "error").length;
  const { item, child } = findNav(screen);
  const Icon = item.icon;
  return (
    <header className={`topbar${corpusSwitcher ? " topbar--switch" : ""}`}>
      <h1 className="topbar__title">
        <Icon {...ICON} aria-hidden="true" />
        <span className={child ? "topbar__section" : undefined}>{item.label}</span>
        {child && (
          <>
            <ChevronRight {...ICON} size={14} className="topbar__crumb topbar__sep" aria-hidden="true" />
            <span className="topbar__crumb" style={{ color: "var(--text-2)" }}>{child.label}</span>
          </>
        )}
      </h1>
      {corpusSwitcher && <CorpusSwitcher />}
      <div className="topbar__actions">
        <BusyIndicator />
        <button type="button" className="status-pill" onClick={() => setDialog("connect")} title="Connection settings">
          <span className="dot" style={{ background: connection.connected ? "var(--positive)" : "var(--text-4)", color: connection.connected ? "var(--positive)" : "transparent" }} aria-hidden="true" />
          {connection.connected ? (
            <>
              <span className="topbar__hide-narrow">{connection.user}@{connection.host}</span>
              {engine && <span className="mono topbar__hide-narrow">CQP {engine}</span>}
              <span className="sr-only">, connected — connection settings</span>
            </>
          ) : (
            <span>Connect<span className="sr-only"> — connection settings</span></span>
          )}
        </button>
        <div style={{ position: "relative" }}>
          <Button variant="ghost" icon={SquareTerminal} aria-label={`Console${consoleErrors ? `, ${consoleErrors} errors` : ""}`} title="Console: commands sent and replies received (Ctrl+`)"
            aria-pressed={consoleOpen} onClick={() => setConsoleOpen((o) => !o)} />
          {consoleErrors > 0 && <span className="badge-dot" aria-hidden="true" />}
        </div>
        <ThemeMenu />
      </div>
    </header>
  );
}
