import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { NAV, canonicalScreen } from "../nav.js";
import { GUIDES } from "../guides.js";
import { ICON, Tabs } from "./ui.jsx";

const KEY = (id) => `hapax.guide.${id}`;

/** Collapsible "How this page works" panel. Open on first visit, then remembered. */
export function Guide({ id }) {
  const g = GUIDES[id];
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(KEY(id));
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  if (!g) return null;
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(KEY(id), o ? "0" : "1"); } catch { /* convenience only */ }
      return !o;
    });
  };
  const bodyId = `guide-${id.replace("/", "-")}`;
  return (
    <section className={`guide${open ? " is-open" : ""}`} aria-label={`How to use ${g.title}`}>
      <button type="button" className="guide__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <Info {...ICON} size={15} aria-hidden="true" />
        <span className="guide__purpose">{g.purpose}</span>
        <span className="guide__hint">{open ? "Hide guide" : "How it works"}</span>
        <ChevronDown {...ICON} size={14} className="guide__chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="guide__body" id={bodyId}>
          <div>
            <h3 className="guide__h">Steps</h3>
            <ol className="guide__steps">{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
          {g.notes.length > 0 && (
            <div>
              <h3 className="guide__h">Good to know</h3>
              <ul className="guide__notes">{g.notes.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Page title + section tabs + guide, identical on every screen.
 * `aside` is a short muted qualifier (corpus name, count, state).
 */
export function PageHeader({ aside, title }) {
  const { screen, setScreen } = useApp();
  const id = canonicalScreen(screen);
  const group = NAV.find((n) => n.children?.some((c) => c.id === id));
  const label = title || GUIDES[id]?.title || NAV.find((n) => n.id === id)?.label || "";
  return (
    <>
      <h2 className="page-title">
        {label}
        {aside != null && aside !== "" && <span className="page-title__muted">{aside}</span>}
      </h2>
      {group && <Tabs value={id} onChange={setScreen} label={group.label} options={group.children.map((c) => [c.id, c.label])} />}
      <Guide key={id} id={id} />
    </>
  );
}
