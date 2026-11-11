import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, RefreshCw, X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { checkForUpdate } from "../lib/updates.js";
import { Button, ICON } from "./ui.jsx";

const STARTUP_DELAY_MS = 4000; // let the window settle before touching the network

/**
 * Checks GitHub Releases once per start-up and offers the new version.
 * A manual check can be requested with `window.dispatchEvent(new Event("hapax:check-updates"))`.
 */
export function UpdateNotice() {
  const { toast } = useApp();
  const [update, setUpdate] = useState(null);
  const [open, setOpen] = useState(true);
  const [progress, setProgress] = useState(null); // null = idle, number 0..1, or "install"
  const [dismissed, setDismissed] = useState(false);
  const checking = useRef(false);

  const run = useCallback(async (manual) => {
    if (checking.current) return;
    checking.current = true;
    try {
      const u = await checkForUpdate();
      if (u) { setUpdate(u); setDismissed(false); }
      else if (manual) toast("Hapax is up to date.", "positive", 3000);
    } catch (e) {
      // Start-up checks stay silent (offline, no release yet); manual checks explain.
      if (manual) toast(`Could not check for updates: ${e?.message || e}`, "warning", 8000);
    } finally {
      checking.current = false;
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => run(false), STARTUP_DELAY_MS);
    const onManual = () => run(true);
    window.addEventListener("hapax:check-updates", onManual);
    return () => { clearTimeout(t); window.removeEventListener("hapax:check-updates", onManual); };
  }, [run]);

  if (!update || dismissed) return null;
  const busy = progress != null;
  const linux = /Linux/i.test(navigator.userAgent);
  const notes = parseNotes(update.notes);
  const count = notes.filter((n) => n.kind === "item").length;

  const install = async () => {
    setProgress(0);
    try {
      await update.install((f) => setProgress(f == null ? "install" : f));
    } catch (e) {
      setProgress(null);
      toast(`The update was not installed: ${e?.message || e}`, "negative", 0);
    }
  };

  return (
    <section className="update" role="status" aria-label="Update available">
      <div className="update__head">
        <Download {...ICON} size={16} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div className="update__title">Hapax {update.version} is available</div>
          <div className="update__sub">You have {update.current}.{linux ? " Installing asks for your system password." : ""}</div>
        </div>
        {!busy && (
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Remind me next start" title="Later" onClick={() => setDismissed(true)}>
            <X {...ICON} size={14} />
          </button>
        )}
      </div>
      {count > 0 && (
        <>
          <button type="button" className="update__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            What changed ({count})
            <ChevronDown {...ICON} size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur)" }} aria-hidden="true" />
          </button>
          {open && (
            <div className="update__notes" tabIndex={0} role="region" aria-label="What changed">
              {groupNotes(notes).map((g, i) => (
                <div key={i}>
                  {g.heading && <div className="update__group">{g.heading}</div>}
                  <ul>{g.items.slice(0, 30).map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {busy ? (
        <div className="update__progress" aria-live="polite">
          <div className="update__bar"><span style={{ width: `${typeof progress === "number" ? Math.round(progress * 100) : 100}%` }} /></div>
          <span className="mono">{typeof progress === "number" && progress < 1 ? `Downloading ${Math.round(progress * 100)}%` : "Installing — Hapax will restart"}</span>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setDismissed(true)}>Later</Button>
          <Button variant="primary" icon={RefreshCw} onClick={install}>Install and restart</Button>
        </div>
      )}
    </section>
  );
}

/**
 * Release notes: `## ` headings, `- ` items (continuation lines join the item)
 * and **bold**. See docs/releasing.md → Writing release notes.
 */
export function parseNotes(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,3}\s+/.test(line)) out.push({ kind: "heading", text: line.replace(/^#+\s+/, "") });
    else if (/^[-*]\s+/.test(line)) out.push({ kind: "item", text: line.replace(/^[-*]\s+/, "") });
    else if (out.at(-1)?.kind === "item") out.at(-1).text += ` ${line}`;
    else out.push({ kind: "item", text: line });
  }
  return out;
}

function groupNotes(notes) {
  const groups = [];
  for (const n of notes) {
    if (n.kind === "heading" || !groups.length) groups.push({ heading: n.kind === "heading" ? n.text : null, items: [] });
    if (n.kind === "item") groups.at(-1).items.push(n.text);
  }
  return groups.filter((g) => g.items.length);
}

function inline(text) {
  const code = (t, k) => t.split(/(`[^`]+`)/g).map((part, i) =>
    /^`[^`]+`$/.test(part) ? <code key={`${k}.${i}`}>{part.slice(1, -1)}</code> : part);
  return text.split(/(\*\*.+?\*\*)/g).map((part, i) =>
    /^\*\*.+\*\*$/.test(part) ? <strong key={i}>{code(part.slice(2, -2), i)}</strong> : code(part, i));
}
