import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { NAV, canonicalScreen } from "../nav.js";
import { GUIDES } from "../guides.js";
import { ICON, Tabs } from "./ui.jsx";

const KEY = (id) => `hapax.guide.${id}`;
/** Set once the user has hidden any guide: from then on, unvisited guides start closed too. */
const LEARNED = "hapax.guide.__learned";
/** Screens whose content already is documentation get no guide panel. */
const NO_GUIDE = new Set(["help"]);

function initiallyOpen(id) {
  try {
    const v = localStorage.getItem(KEY(id));
    if (v != null) return v === "1";
    return localStorage.getItem(LEARNED) !== "1"; // beginners: open; anyone who has closed one: closed
  } catch {
    return true;
  }
}

/** Reopen every guide (used by Methods & help). */
export function resetGuides() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("hapax.guide.")) localStorage.removeItem(k);
  } catch { /* convenience only */ }
}

/**
 * Collapsible "How this page works" panel. The purpose line is always visible;
 * the steps open on a first visit until the user hides any guide once, after
 * which guides stay closed unless opened — beginners get the walkthrough,
 * repeat users get the space back.
 */
export function Guide({ id }) {
  const g = GUIDES[id];
  const [open, setOpen] = useState(() => initiallyOpen(id));
  if (!g || NO_GUIDE.has(id)) return null;
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY(id), o ? "0" : "1");
        if (o) localStorage.setItem(LEARNED, "1");
      } catch { /* convenience only */ }
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
