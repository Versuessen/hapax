import { useEffect, useState } from "react";
import { ChevronDown, PanelLeft, Search } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { NAV, corpusColor, corpusFamily, corporaByVariety, varietyInfo } from "../nav.js";
import { Flag } from "./Flag.jsx";
import { BrandMark, ICON, Kbd } from "./ui.jsx";
import { compact } from "../lib/format.js";
import { modKey } from "../lib/platform.js";

function useNarrow(query = "(max-width: 900px)") {
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

export function Sidebar({ collapsed: userCollapsed, onToggle }) {
  const narrow = useNarrow();
  const collapsed = userCollapsed || narrow;
  const { screen, setScreen, setDialog, evidence, prefs, info, query, setQuery, setSearch } = useApp();
  const [open, setOpen] = useState(() => ({ analysis: screen.startsWith("analysis"), workflows: screen.startsWith("workflows") }));

  useEffect(() => {
    const top = screen.split("/")[0];
    if (top === "analysis" || top === "workflows") setOpen((o) => ({ ...o, [top]: true }));
  }, [screen]);

  const meta = { evidence: evidence.length || null, saved: prefs?.saved_searches?.length || null };

  const pickCorpus = (name) => {
    if (name !== query.corpus) {
      setQuery({ ...query, corpus: name, meta_attr: "", meta_value: "", filters: [] });
      setSearch(null);
    }
    if (!["search", "corpus", "overview"].includes(screen)) setScreen("search");
  };

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
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            <PanelLeft {...ICON} />
          </button>
        </div>
        <button type="button" className="search-trigger" onClick={() => setDialog("palette")} aria-label="Search commands, screens and corpora" title={`Search (${modKey}+K)`}>
          <Search {...ICON} aria-hidden="true" />
          <span className="search-trigger__label">Search</span>
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
                      if (n.children) {
                        if (collapsed) setScreen(n.children[0].id);
                        else setOpen((o) => ({ ...o, [n.id]: !o[n.id] }));
                      } else setScreen(n.id);
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
      </div>
    </aside>
  );
}
