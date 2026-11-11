import { useEffect, useState } from "react";
import { PanelLeft, Search } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { NAV } from "../nav.js";
import { BrandMark, ICON, Kbd } from "./ui.jsx";
import { modKey } from "../lib/platform.js";

/** Below this width the sidebar is always an icon rail. */
export const RAIL_QUERY = "(max-width: 1100px)";

export function useNarrow(query = RAIL_QUERY) {
  const [m, setM] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * Six flat destinations. Views inside Search and Corpora are switched in the
 * page itself (and with Ctrl+1…6), so the sidebar never needs sub-menus.
 * The working corpus is chosen in the top bar.
 */
export function Sidebar({ collapsed, narrow, drawer = false, onToggle }) {
  const { screen, setScreen, setDialog, evidence, evidenceDirty } = useApp();
  const meta = { evidence: evidence.length ? String(evidence.length) : null };
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar__top">
        <div className="brand">
          <BrandMark />
          <span className="brand__name">Hapax</span>
          <button
            type="button"
            className="btn btn--ghost btn--icon brand__toggle"
            onClick={onToggle}
            aria-label={narrow ? (drawer ? "Close menu" : "Open menu") : collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={narrow ? (drawer ? "Close menu (Esc)" : "Open menu with labels") : collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={narrow ? undefined : collapsed}
            aria-expanded={narrow ? drawer : undefined}
          >
            <PanelLeft {...ICON} />
          </button>
        </div>
        <button type="button" className="search-trigger" onClick={() => setDialog("palette")} title={`Commands, screens, corpora and searches (${modKey}+K)`}>
          <Search {...ICON} aria-hidden="true" />
          <span className="search-trigger__label">Go to…<span className="sr-only"> (commands, screens, corpora and saved searches)</span></span>
          <span className="kbd-group" aria-hidden="true"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
        </button>
      </div>
      <div className="sidebar__divider" />
      <div className="sidebar__scroll">
        <nav className="nav-section" aria-label="Screens">
          <ul className="nav-list">
            {NAV.map((n, i) => {
              const Icon = n.icon;
              const active = screen === n.id || screen.startsWith(`${n.id}/`);
              const m = n.meta ? meta[n.meta] : null;
              return (
                <li key={n.id}>
                  <button type="button" className="nav-item" aria-current={active ? "page" : undefined}
                    title={`${n.label} (Alt+${i + 1})`} onClick={() => setScreen(n.id)}>
                    <Icon {...ICON} aria-hidden="true" fill={active && n.id === "home" ? "currentColor" : "none"} />
                    <span className="nav-item__label">{n.label}</span>
                    {m != null && <span className="nav-item__meta">{m}{n.meta === "evidence" && evidenceDirty && <span className="nav-item__dirty" title="Unsaved changes"><span className="sr-only">, unsaved changes</span></span>}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
