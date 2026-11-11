import { lazy, Suspense, useEffect, useState } from "react";
import { AppProvider, useApp } from "./state/store.jsx";
import { Sidebar, useNarrow } from "./components/Sidebar.jsx";
import { Guide } from "./components/PageHeader.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { CommandPalette, ConnectDialog, HostKeyDialog, ShortcutsDialog, Toasts } from "./components/Dialogs.jsx";
import { Spinner } from "./components/ui.jsx";
import { ConsolePanel } from "./components/ConsolePanel.jsx";
import { UpdateNotice } from "./components/UpdateNotice.jsx";
import { matches, useCommands } from "./commands.js";
import { isMac } from "./lib/platform.js";
import Home from "./screens/Home.jsx";
import Search from "./screens/Search.jsx";

const Combine = lazy(() => import("./screens/Combine.jsx"));
const Corpus = lazy(() => import("./screens/Corpus.jsx"));
const Evidence = lazy(() => import("./screens/Evidence.jsx"));
const Help = lazy(() => import("./screens/Help.jsx"));

function Screen({ id }) {
  switch (id.split("/")[0]) {
    case "search": return <Search />;
    case "corpora": return <Corpus />;
    case "combine": return <Combine />;
    case "evidence": return <Evidence />;
    case "help": return <Help />;
    default: return <Home />;
  }
}

/** Keyboard: every shortcut comes from the command registry (src/commands.js). */
function useShortcuts() {
  const { dialog } = useApp();
  const commands = useCommands();
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      for (const c of commands) {
        if (!c.run || c.local || !matches(c.keys, e)) continue;
        if (dialog && !c.always) continue;
        if (c.when && !c.when()) continue;
        // Plain keys (and Option+arrows on macOS, which move by word) belong to the field.
        const bare = !c.keys.mod && !/^F\d+$/.test(c.keys.key) && !(c.keys.alt && !isMac);
        if (typing && bare) continue; // plain keys and Alt+arrows belong to the field
        e.preventDefault();
        c.run();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, dialog]);
}

function Shell() {
  const { info, screen, query, guideOpen } = useApp();
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
        <Topbar />
        <div className="content" id="content" tabIndex={-1}>
          {info ? (
            <Suspense fallback={<div className="page"><Spinner /></div>}>
              {guideOpen && <div className="page page--guide"><Guide id={screen} /></div>}
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
      <ShortcutsDialog />
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
