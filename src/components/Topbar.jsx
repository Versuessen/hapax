import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Monitor, Moon, Square, SquareTerminal, Sun } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { findNav } from "../nav.js";
import { Button, ICON, Spinner } from "./ui.jsx";
import { seconds } from "../lib/format.js";

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
        <span className="topbar__hide-narrow" style={{ color: "var(--text-2)", fontSize: 13 }}>{busy.label}</span>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{((now - busy.startedAt) / 1000).toFixed(1)} s</span>
        <Button icon={Square} onClick={cancel} title="Stop request (closes the SSH channel; best effort)">Stop</Button>
      </div>
    );
  }
  if (!lastRun) return null;
  return (
    <span className="mono topbar__hide-narrow" style={{ color: "var(--text-3)", fontSize: 12 }} title="Client wall-clock time: SSH round trip, remote execution and parsing — not backend-only speed">
      {seconds(lastRun.elapsed)} · {lastRun.cached ? "cached" : "SSH request"}
    </span>
  );
}

export function Topbar() {
  const { screen, connection, engine, setDialog, consoleOpen, setConsoleOpen, consoleLog } = useApp();
  const consoleErrors = consoleLog.filter((e) => e.status === "error").length;
  const { item, child } = findNav(screen);
  const Icon = item.icon;
  return (
    <header className="topbar">
      <h1 className="topbar__title">
        <Icon {...ICON} aria-hidden="true" />
        <span>{item.label}</span>
        {child && (
          <>
            <ChevronRight {...ICON} size={14} className="topbar__crumb" aria-hidden="true" />
            <span className="topbar__crumb" style={{ color: "var(--text-2)" }}>{child.label}</span>
          </>
        )}
      </h1>
      <div className="topbar__actions">
        <BusyIndicator />
        <button type="button" className="status-pill" onClick={() => setDialog("connect")} aria-label="Connection settings">
          <span className="dot" style={{ background: connection.connected ? "var(--positive)" : "var(--text-4)", color: connection.connected ? "var(--positive)" : "transparent" }} aria-hidden="true" />
          {connection.connected ? (
            <>
              <span className="topbar__hide-narrow">{connection.user}@{connection.host}</span>
              {engine && <span className="mono topbar__hide-narrow">CQP {engine}</span>}
              <span className="sr-only">Connected</span>
            </>
          ) : (
            <span>Connect</span>
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
