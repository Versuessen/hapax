import { useEffect, useRef, useState } from "react";
import { ChevronDown, PanelLeft, Search } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { NAV, corpusColor, corpusFamily, corporaByVariety, varietyInfo } from "../nav.js";
import { Flag } from "./Flag.jsx";
import { BrandMark, ICON, Kbd } from "./ui.jsx";
import { compact } from "../lib/format.js";
import { modKey } from "../lib/platform.js";

/** Below this width the sidebar is always an icon rail (P4). */
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

/** Choosing a working corpus: screens about a corpus stay put; elsewhere it means "search it". */
export function usePickCorpus() {
  const { screen, setScreen, query, setQuery, setSearch } = useApp();
  return (name) => {
    if (name !== query.corpus) {
      setQuery({ ...query, corpus: name, meta_attr: "", meta_value: "", filters: [] });
      setSearch(null);
    }
    if (!["find/search", "corpora/details", "corpora/tags", "home"].includes(screen)) setScreen("find/search");
  };
}

export function Sidebar({ collapsed, narrow, onToggle }) {
  const { screen, setScreen, setDialog, evidence, prefs, info, query } = useApp();
  const pickCorpus = usePickCorpus();
  const groupOf = (id) => NAV.find((n) => n.children?.some((c) => c.id === id))?.id;
  const [open, setOpen] = useState(() => (groupOf(screen) ? { [groupOf(screen)]: true } : {}));
  // Last screen visited in each section, so returning to a section lands where you left it.
  const lastIn = useRef({});

  useEffect(() => {
    const g = groupOf(screen);
    if (g) {
      lastIn.current[g] = screen;
      setOpen((o) => (o[g] ? o : { ...o, [g]: true }));
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = { evidence: evidence.length || null, saved: prefs?.saved_searches?.length || null };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar__top">
        <div className="brand">
          <BrandMark />
          <span className="brand__name">Hapax</span>
          {!narrow && (
          <button
            type="button"
            className="btn btn--ghost btn--icon brand__toggle"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            <PanelLeft {...ICON} />
          </button>
          )}
        </div>
        <button type="button" className="search-trigger" onClick={() => setDialog("palette")} title={`Search (${modKey}+K)`}>
          <Search {...ICON} aria-hidden="true" />
          <span className="search-trigger__label">Search<span className="sr-only"> screens, corpora and saved searches</span></span>
          <span className="kbd-group" aria-hidden="true">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>
      <div className="sidebar__divider" />

      <div className="sidebar__scroll">
        <nav className="nav-section" aria-label="Screens">
          <div className="nav-section__label"><span>Navigation</span></div>
          <ul className="nav-list">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = screen === n.id || screen.startsWith(`${n.id}/`);
              const expanded = !!open[n.id];
              const m = n.meta ? meta[n.meta] : null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className="nav-item"
                    aria-current={active && (!n.children || collapsed) ? "page" : undefined}
                    aria-expanded={n.children ? expanded : undefined}
                    title={n.label}
                    onClick={() => {
                      if (!n.children) return setScreen(n.id);
                      // Inside this section: the label folds it. Elsewhere: go there (last visited page) and unfold.
                      if (active && !collapsed) return setOpen((o) => ({ ...o, [n.id]: !o[n.id] }));
                      setOpen((o) => ({ ...o, [n.id]: true }));
                      setScreen(lastIn.current[n.id] || n.children[0].id);
                    }}
                  >
                    <Icon {...ICON} aria-hidden="true" fill={active && n.id === "home" ? "currentColor" : "none"} />
                    <span className="nav-item__label">{n.label}</span>
                    {m != null && <span className="nav-item__meta">{m}</span>}
                    {n.children && <ChevronDown {...ICON} size={14} className="nav-item__chevron" aria-hidden="true" />}
                  </button>
                  {n.children && expanded && !collapsed && (
                    <ul className="nav-sub">
                      {n.children.map((c) => (
                        <li key={c.id}>
                          <button type="button" className="nav-item" aria-current={screen === c.id ? "page" : undefined} onClick={() => setScreen(c.id)}>
                            <span className="nav-item__label">{c.label}</span>
                            {c.meta && meta[c.meta] != null && <span className="nav-item__meta">{meta[c.meta]}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {!collapsed && (
        <nav className="nav-section nav-section--corpora" aria-label="Working corpus">
          <div className="nav-section__label"><span>Working corpus</span></div>
          <ul className="nav-list">
            {info &&
              corporaByVariety(info).flatMap((g) => [
                <li key={`v:${g.key}`} className="nav-group-label" aria-hidden="true" title={g.info.label}>
                  <Flag variety={g.variety} size={15} />
                  <span>{g.info.label}</span>
                </li>,
                ...g.corpora.map((c) => {
                const ci = info.corpora[c];
                const offline = ci.available === false;
                const broken = ci.encoding === "<unsupported>";
                const why = offline ? " · not on the server at the last check" : broken ? " · cannot be searched (registry charset)" : ci.source === "discovered" ? " · found on the server" : "";
                return (
                <li key={c}>
                  <button
                    type="button"
                    className="nav-item corpus-item"
                    aria-pressed={query.corpus === c}
                    disabled={offline}
                    title={`${c} — ${ci.description} · ${ci.variety_note || varietyInfo(ci.variety).label} · ${corpusFamily(c).label}${why}`}
                    onClick={() => pickCorpus(c)}
                    style={query.corpus === c ? { color: "var(--text-1)" } : offline ? { opacity: 0.45 } : undefined}
                  >
                    <span className="dot" style={{ background: corpusColor(c), color: corpusColor(c) }} aria-hidden="true" />
                    <span className="nav-item__label">{c}</span>
                    <span className="nav-item__meta">{offline ? "offline" : broken ? "n/a" : ci.tokens ? compact(ci.tokens) : "new"}</span>
                  </button>
                </li>
                );
                }),
              ])}
          </ul>
        </nav>
        )}
      </div>
    </aside>
  );
}
