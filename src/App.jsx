import { lazy, Suspense, useEffect, useState } from "react";
import { AppProvider, useApp } from "./state/store.jsx";
import { Sidebar, useNarrow } from "./components/Sidebar.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { CommandPalette, ConnectDialog, HostKeyDialog, Toasts } from "./components/Dialogs.jsx";
import { Spinner } from "./components/ui.jsx";
import { ConsolePanel } from "./components/ConsolePanel.jsx";
import { UpdateNotice } from "./components/UpdateNotice.jsx";
import { SCREENS } from "./nav.js";
import { isMod } from "./lib/platform.js";
import Overview from "./screens/Overview.jsx";
import Search from "./screens/Search.jsx";

const Analysis = lazy(() => import("./screens/Analysis.jsx"));
const Workflows = lazy(() => import("./screens/Workflows.jsx"));
const Corpus = lazy(() => import("./screens/Corpus.jsx"));
const Syntax = lazy(() => import("./screens/Syntax.jsx"));
const Evidence = lazy(() => import("./screens/Evidence.jsx"));
const Saved = lazy(() => import("./screens/Saved.jsx"));
const Learn = lazy(() => import("./screens/Learn.jsx"));
const Help = lazy(() => import("./screens/Help.jsx"));

function Screen({ id }) {
  switch (id) {
    case "find/search": return <Search />;
    case "find/guided": return <Learn />;
    case "find/saved": return <Saved />;
    case "analyse/counts": return <Analysis sub="counts" />;
    case "analyse/nearby": return <Analysis sub="nearby" />;
    case "analyse/spread": return <Analysis sub="spread" />;
    case "analyse/compare": return <Workflows sub="compare" />;
    case "analyse/syntax": return <Syntax />;
    case "combine": return <Workflows sub="builder" />;
    case "corpora/details": return <Corpus />;
    case "corpora/tags": return <Analysis sub="tags" />;
    case "evidence": return <Evidence />;
    case "help": return <Help />;
    default: return <Overview />;
  }
}

function useShortcuts() {
  const { setDialog, setScreen, screen, dialog, setConsoleOpen } = useApp();
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (isMod(e) && k === "k") {
        e.preventDefault();
        setDialog(dialog === "palette" ? null : "palette");
        return;
      }
      if (isMod(e) && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        setConsoleOpen((o) => !o);
        return;
      }
      if (dialog) return;
      if (e.key === "F1") {
        e.preventDefault();
        setScreen("help");
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const target = SCREENS[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          setScreen(target);
        }
      } else if (isMod(e) && e.key === "Enter") {
        e.preventDefault();
        if (screen !== "find/search") setScreen("search");
        setTimeout(() => window.dispatchEvent(new CustomEvent("cqp:search")), 0);
      } else if (isMod(e) && k === "l") {
        e.preventDefault();
        if (screen !== "find/search") setScreen("search");
        setTimeout(() => document.querySelector("[data-search-term]")?.focus(), 30);
      } else if (isMod(e) && k === "s" && screen === "find/search") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("cqp:save"));
      } else if (isMod(e) && k === "e" && screen === "find/search") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("cqp:export"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDialog, setScreen, screen, dialog, setConsoleOpen]);
}

function Shell() {
  const { info, screen, query } = useApp();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("cqp.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const narrow = useNarrow();
  // Below 1100 px the rail can open the full sidebar as an overlay (labels, sub-pages, corpora).
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [screen, query.corpus, narrow]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e) => { if (e.key === "Escape") { setDrawer(false); document.querySelector(".brand__toggle")?.focus(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [drawer]);
  useShortcuts();
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("cqp.sidebar", c ? "open" : "collapsed");
      } catch {
        /* per-viewer convenience only */
      }
      return !c;
    });

  return (
    <div className="shell" data-collapsed={(collapsed || narrow) && !drawer} data-drawer={drawer || undefined}>
      <a className="skip-link" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById("content")?.focus(); }}>Skip to content</a>
      <Sidebar collapsed={(collapsed || narrow) && !drawer} narrow={narrow} drawer={drawer} onToggle={narrow ? () => setDrawer((d) => !d) : toggle} />
      {drawer && <div className="scrim" aria-hidden="true" onClick={() => setDrawer(false)} />}
      <main className="main">
        <Topbar corpusSwitcher={collapsed || narrow} />
        <div className="content" id="content" tabIndex={-1}>
          {info ? (
            <Suspense fallback={<div className="page"><Spinner /></div>}>
              <Screen id={screen} key={screen.split("/")[0]} />
            </Suspense>
          ) : (
            <div className="page"><Spinner label="Loading" /></div>
          )}
        </div>
        <ConsolePanel />
      </main>
      <ConnectDialog />
      <HostKeyDialog />
      <CommandPalette />
      <UpdateNotice />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
