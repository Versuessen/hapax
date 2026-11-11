import { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Info, KeyRound, Search, ShieldAlert, TriangleAlert, X, History } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { corpusColor, orderedCorpora } from "../nav.js";
import { keyLabel, useCommands } from "../commands.js";
import { Button, Checkbox, Dialog, Field, ICON, Input, Kbd, Notice } from "./ui.jsx";
import { compact } from "../lib/format.js";
import { queryLabel } from "../lib/query.js";

export function ConnectDialog() {
  const { dialog, setDialog, prefs, connection, connect, disconnect, engine, toast, busy, pending } = useApp();
  const open = dialog === "connect";
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState(22);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !prefs) return;
    setHost(connection.host || prefs.host || "");
    setUser(connection.user || prefs.user || "");
    setPort(prefs.port || 22);
    setPassword("");
    setError(null);
    // Reset only when the dialog opens — never while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!prefs]);

  useEffect(() => {
    if (!open || !host || !user) return setSaved(false);
    const t = setTimeout(() => invoke("has_saved_password", { host, user, port: Number(port) }).then(setSaved).catch(() => setSaved(false)), 250);
    return () => clearTimeout(t);
  }, [open, host, user, port]);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    try {
      await connect({ host: host.trim(), user: user.trim(), port: Number(port) || 22, password, remember });
      setPassword("");
      setDialog(null);
    } catch (err) {
      setError(err);
    }
  };

  const forget = async () => {
    try {
      const removed = await invoke("forget_password", { host, user, port: Number(port) });
      setSaved(false);
      toast(removed ? "Saved password removed from the credential vault." : "No saved password was found.", "neutral");
    } catch (err) {
      toast(err.message, "negative");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && setDialog(null)}
      title={connection.connected ? "Connection" : "Connect to the corpus server"}
      text="Read-only CQP over your own university SSH login. Your password is typed here and, if you choose, stored only in the operating system's credential vault."
    >
      <form onSubmit={submit}>
        <div className="dialog__body">
          {!connection.connected && pending && (
            <Notice tone="info">Sign in to continue: <strong>{pending.label}</strong> runs as soon as you are connected.</Notice>
          )}
          {connection.connected && (
            <Notice tone="info">
              Connected as <strong>{connection.user}@{connection.host}</strong>{engine ? ` · CQP ${engine}` : ""}. Connecting again replaces this session.
            </Notice>
          )}
          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 92px" }}>
            <Field label="Host" htmlFor="c-host">
              <Input id="c-host" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" spellCheck={false} required />
            </Field>
            <Field label="Port" htmlFor="c-port">
              <Input id="c-port" mono type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            </Field>
          </div>
          <Field label="Username" htmlFor="c-user">
            <Input id="c-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} required />
          </Field>
          <Field label="Password" htmlFor="c-pw" hint={saved ? "A saved password exists for this account — leave blank to use it." : "Leave blank to use your ~/.ssh keys."}>
            <Input id="c-pw" type="password" data-autofocus={(prefs?.host || connection.host) && (prefs?.user || connection.user) && !connection.connected ? "" : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <div className="row">
            <Checkbox label="Remember password on this computer" checked={remember} onChange={setRemember} disabled={!password} />
            <span className="spacer" />
            {saved && <Button variant="ghost" onClick={forget}>Forget saved password</Button>}
          </div>
          {error && <Notice tone={error.kind === "host_key" ? "warn" : "neg"}>{error.message}</Notice>}
        </div>
        <div className="dialog__foot">
          {connection.connected && (
            <Button variant="danger" onClick={() => disconnect().then(() => setDialog(null))} disabled={!!busy} style={{ marginRight: "auto" }}>
              Disconnect
            </Button>
          )}
          <Button onClick={() => setDialog(null)} disabled={!!busy}>Cancel</Button>
          <button type="submit" className="btn btn--primary" disabled={!!busy || !host || !user}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function HostKeyDialog() {
  const { hostKey, answerHostKey } = useApp();
  return (
    <Dialog
      open={!!hostKey}
      onClose={() => answerHostKey(false)}
      title="Verify the server's identity"
      text="This server's SSH key is not yet in your known_hosts file. Compare the fingerprint with one published by the university before trusting it."
      footer={
        <>
          <Button onClick={() => answerHostKey(false)}>Don't trust</Button>
          <Button variant="primary" icon={KeyRound} onClick={() => answerHostKey(true)}>Trust and remember</Button>
        </>
      }
    >
      {hostKey && (
        <div className="dialog__body">
          <dl className="dl">
            <dt>Host</dt><dd>{hostKey.host}:{hostKey.port}</dd>
            <dt>Algorithm</dt><dd className="mono">{hostKey.key_type}</dd>
            <dt>Fingerprint</dt><dd className="mono" style={{ fontSize: "var(--fs-small)" }}>{hostKey.fingerprint}</dd>
            <dt>Saved to</dt><dd className="mono" style={{ fontSize: "var(--fs-mono)", color: "var(--text-2)" }}>{hostKey.known_hosts_path}</dd>
          </dl>
          <Notice tone="warn">A changed key for a known host is always refused. That situation can indicate an interception attack.</Notice>
        </div>
      )}
    </Dialog>
  );
}

export function CommandPalette() {
  const { dialog, setDialog, setScreen, info, prefs, query, setQuery, setSearch, recent } = useApp();
  const commands = useCommands();
  const open = dialog === "palette";
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const out = [];
    const cmd = (c) => ({ group: c.group, label: c.label, keys: c.keys, run: c.run });
    const usable = commands.filter((c) => c.run && !c.hidden && !c.local && (!c.when || c.when() || c.group === "Search"));
    const order = ["Search", "Go to", "Search views", "Corpora views"];
    order.forEach((g) => usable.filter((c) => c.group === g).forEach((c) => out.push(cmd(c))));
    if (info)
      orderedCorpora(info).filter((c) => info.corpora[c].available !== false).forEach((c) =>
        out.push({
          group: "Working corpus", label: c, dot: corpusColor(c), meta: compact(info.corpora[c].tokens),
          run: () => { if (c !== query.corpus) { setQuery({ ...query, corpus: c, meta_attr: "", meta_value: "", filters: [] }); setSearch(null); } setScreen("search"); },
        })
      );
    (recent || []).slice(0, 10).forEach((r) =>
      out.push({
        group: "Recent searches", icon: History, meta: `${Number(r.total).toLocaleString()} hits`,
        label: `${r.query.corpus} · ${r.query.manual ? queryLabel(r.query) : [r.query.value, ...(r.query.next || []).map((t) => t.value), r.query.second_value].filter(Boolean).join(" ") || queryLabel(r.query)}`,
        run: () => { setQuery(r.query); setSearch(null); setScreen("search/matches"); setTimeout(() => window.dispatchEvent(new Event("cqp:search")), 50); },
      })
    );
    (prefs?.saved_searches || []).forEach((s) =>
      out.push({ group: "Saved searches", label: s.name, icon: Search, run: () => { setQuery((cur) => ({ ...cur, ...s.query })); setSearch(null); setScreen("search"); } })
    );
    usable.filter((c) => !order.includes(c.group)).forEach((c) => out.push(cmd(c)));
    return out;
  }, [commands, info, prefs, recent, query, setQuery, setScreen, setSearch]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.group} ${i.label}`.toLowerCase().includes(s)) : items;
  }, [items, q]);

  const choose = (i) => {
    const it = filtered[i];
    if (!it) return;
    setDialog(null);
    it.run();
  };

  let lastGroup = null;
  return (
    <Dialog open={open} onClose={() => setDialog(null)} className="palette" labelledBy="palette-label">
      <div className="palette__input">
        <Search {...ICON} aria-hidden="true" />
        <label id="palette-label" htmlFor="palette-q" className="sr-only">Commands, views, corpora and saved searches</label>
        <input
          id="palette-q"
          autoFocus
          value={q}
          placeholder="Run a command, go to a view, corpus or saved search…"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter") { e.preventDefault(); choose(sel); }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={`pal-${sel}`}
        />
      </div>
      <ul className="palette__list" id="palette-list" role="listbox">
        {filtered.length === 0 && <li className="palette__group">No matches</li>}
        {filtered.map((it, i) => {
          const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
          const I = it.icon;
          return (
            <li key={`${it.group}-${it.label}`} role="presentation">
              {head && <div className="palette__group" role="presentation">{head}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === sel} className="palette__item" onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
                {it.dot ? <span className="dot" style={{ background: it.dot, color: it.dot, margin: "0 4px" }} /> : I ? <I {...ICON} aria-hidden="true" /> : <span style={{ width: 16 }} />}
                <span className="palette__label">{it.label}</span>
                {it.meta && <span className="mono">{it.meta}</span>}
                {it.keys && <span className="kbd-group" aria-label={`Shortcut ${keyLabel(it.keys).join(" ")}`}>{keyLabel(it.keys).map((k) => <Kbd key={k} small>{k}</Kbd>)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="palette__foot" aria-hidden="true">
        <span><Kbd small>↑</Kbd><Kbd small>↓</Kbd> move</span>
        <span><Kbd small>↵</Kbd> open</span>
        <span><Kbd small>Esc</Kbd> close</span>
      </div>
    </Dialog>
  );
}

/** Every shortcut, grouped, generated from the command registry. Opened with ? or the top-bar button. */
export function ShortcutsDialog() {
  const { dialog, setDialog } = useApp();
  return (
    <Dialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} wide title="Keyboard shortcuts"
      text="Ctrl+K opens the command palette: it runs everything below and more (switch corpus, rerun recent searches, change theme)."
      footer={<Button onClick={() => setDialog(null)}>Close</Button>}>
      <div className="dialog__body"><ShortcutTable /></div>
    </Dialog>
  );
}

/** The shortcut list itself (also shown on Methods & help). */
export function ShortcutTable() {
  const commands = useCommands();
  const withKeys = [
    { group: "App", label: "Command palette", keys: { key: "k", mod: true } },
    ...commands.filter((c) => c.keys && c.id !== "app.palette" && c.id !== "go.help.f1"),
    { group: "Go to", label: "Methods & help", keys: { key: "F1" } },
  ];
  const groups = [...new Set(withKeys.map((c) => c.group))];
  return (
    <div className="shortcut-grid">
      {groups.map((g) => (
        <section key={g}>
          <h3 className="section-label">{g}</h3>
          <dl className="shortcut-list">
            {withKeys.filter((c) => c.group === g).map((c) => (
              <div key={c.group + c.label + keyLabel(c.keys).join("")} className="shortcut-list__row">
                <dt>{keyLabel(c.keys).map((k) => <Kbd key={k} small>{k}</Kbd>)}{c.alsoKeys && <>{" / "}{keyLabel(c.alsoKeys).map((k) => <Kbd key={k} small>{k}</Kbd>)}</>}</dt>
                <dd>{c.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  const icon = { positive: CircleCheck, negative: CircleAlert, warning: TriangleAlert, neutral: Info };
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => {
        const I = icon[t.tone] || Info;
        return (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === "negative" ? "alert" : "status"}>
            <I {...ICON} className="toast__icon" aria-hidden="true" />
            <div className="toast__msg">{t.message}</div>
            {t.action && (
              <button type="button" className="btn btn--ghost toast__action" onClick={() => { t.action.onClick(); dismissToast(t.id); }}>{t.action.label}</button>
            )}
            <button type="button" className="btn btn--ghost btn--icon" style={{ width: 24, height: 24 }} onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X {...ICON} size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ShieldNote() {
  return <ShieldAlert {...ICON} aria-hidden="true" />;
}
