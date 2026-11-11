import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { GUIDES } from "../guides.js";
import { ICON } from "./ui.jsx";

/**
 * Short page context ("BNC · 112M tokens", "unsaved changes") shown beside
 * the page title in the top bar. Pages render it where they have the data;
 * it is portalled into the top bar so there is one title, not three.
 */
export function PageHeader({ aside }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => setSlot(document.getElementById("page-context")), []);
  if (!slot || aside == null || aside === "") return null;
  return createPortal(<span className="topbar__context">{aside}</span>, slot);
}

/** Older builds remembered guides per page; clearing those keys and opening the guide is enough now. */
export function resetGuides() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("hapax.guide.")) localStorage.removeItem(k);
  } catch { /* convenience only */ }
}

/** The page guide (purpose, steps, notes), opened from the top bar's Guide button. */
export function Guide({ id }) {
  const { guideOpen, setGuideOpen } = useApp();
  const g = GUIDES[id];
  if (!g || !guideOpen) return null;
  return (
    <section className="guide is-open" id="page-guide" aria-label={`How to use ${g.title}`}>
      <div className="guide__head">
        <span className="guide__purpose">{g.purpose}</span>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close guide" title="Close guide" onClick={() => setGuideOpen(false)}>
          <X {...ICON} size={14} />
        </button>
      </div>
      <div className="guide__body">
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
    </section>
  );
}
