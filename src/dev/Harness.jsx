// Phase 1 IPC test harness — deliberately unstyled.
// Every button calls one Rust command and prints the raw JSON reply (or the
// structured error { kind, message }) into the console <pre> below.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, save } from "@tauri-apps/plugin-dialog";

const DELIVER_WORKFLOW = {
  corpus: "BNC-BABY",
  steps: [
    {
      kind: "search",
      query: { field: "lexeme", value: "deliver", second_field: "class", second_value: "ADV", gap: 0, sentence_only: true },
    },
  ],
};

export default function Harness() {
  const [log, setLog] = useState([]);
  const [corpora, setCorpora] = useState([]);
  const [host, setHost] = useState("login.fu-berlin.de");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [query, setQuery] = useState({ corpus: "BROWN-LEGACY", field: "word", value: "jury", ignore_case: true });
  const [groupField, setGroupField] = useState("pos");
  const [offset, setOffset] = useState(0);
  const lastPage = useRef(null);

  const print = (label, payload) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${label}\n${JSON.stringify(payload, null, 2)}`, ...l].slice(0, 60));

  async function call(cmd, args = {}) {
    print(`→ ${cmd}`, args);
    try {
      const out = await invoke(cmd, args);
      print(`← ${cmd} OK`, out);
      return out;
    } catch (err) {
      print(`← ${cmd} ERROR`, err); // { kind, message }
      return null;
    }
  }

  useEffect(() => {
    (async () => {
      const info = await call("get_app_info");
      if (info) setCorpora(Object.keys(info.corpora));
      const prefs = await call("get_preferences");
      if (prefs) {
        setHost(prefs.host);
        setUser(prefs.user);
      }
    })();
    // Host-key verification: Rust waits (max 120 s) for answer_host_key.
    const unlistenKey = listen("ssh://host-key-prompt", async ({ payload }) => {
      print("event ssh://host-key-prompt", payload);
      const trust = await ask(
        `Unknown SSH host: ${payload.host}:${payload.port}\nAlgorithm: ${payload.key_type}\nFingerprint: ${payload.fingerprint}\n\n` +
          "Compare this fingerprint with a trusted university source before accepting.\n\nTrust and remember this host key?",
        { title: "Verify SSH host key", kind: "warning" }
      );
      call("answer_host_key", { requestId: payload.request_id, trust });
    });
    const unlistenConn = listen("ssh://connection", ({ payload }) => print("event ssh://connection", payload));
    return () => {
      unlistenKey.then((f) => f());
      unlistenConn.then((f) => f());
    };
  }, []);

  const set = (k) => (e) => setQuery({ ...query, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function search(off) {
    setOffset(off);
    const out = await call("run_search", { request: { ...query, offset: off, limit: 25, context: 4 } });
    if (out) {
      lastPage.current = { request: { ...query, offset: off, limit: 25, context: 4 }, data: out.data };
      call("interpret_search", { query, total: out.data.total });
    }
  }

  async function exportPage() {
    if (!lastPage.current) return print("export", "Run a search first");
    const path = await save({ defaultPath: "cqp_concordance_page.csv", filters: [{ name: "Table", extensions: ["csv", "tsv", "json"] }] });
    if (!path) return;
    const { request, data } = lastPage.current;
    call("export_concordance_page", { path, request, rows: data.results, total: data.total });
  }

  return (
    <div>
      <h1>Hapax — IPC harness</h1>

      <fieldset>
        <legend>SSH</legend>
        <input placeholder="host" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="user" value={user} onChange={(e) => setUser(e.target.value)} />
        <input placeholder="password (blank = saved)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> remember</label>
        <button onClick={async () => { await call("ssh_connect", { args: { host, user, password, remember } }); setPassword(""); }}>Connect</button>
        <button onClick={() => call("ssh_disconnect")}>Disconnect</button>
        <button onClick={() => call("ssh_status")}>Status</button>
        <button onClick={() => call("run_health")}>Health</button>
        <button onClick={() => call("cancel_request")}>Stop request</button>
        <button onClick={() => call("has_saved_password", { host, user })}>Saved password?</button>
        <button onClick={() => call("forget_password", { host, user })}>Forget password</button>
      </fieldset>

      <fieldset>
        <legend>Search</legend>
        <select value={query.corpus} onChange={set("corpus")}>
          {corpora.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="field" value={query.field} onChange={set("field")} />
        <input placeholder="value" value={query.value} onChange={set("value")} />
        <label><input type="checkbox" checked={!!query.ignore_case} onChange={set("ignore_case")} /> ignore case</label>
        <button onClick={() => call("preview_query", { query })}>Preview CQP</button>
        <button onClick={() => search(0)}>Search</button>
        <button onClick={() => search(Math.max(0, offset - 25))}>Prev</button>
        <button onClick={() => search(offset + 25)}>Next</button>
        <button onClick={exportPage}>Export page…</button>
        <br />
        <input placeholder="group field" value={groupField} onChange={(e) => setGroupField(e.target.value)} />
        <button onClick={() => call("run_frequencies", { request: { ...query, group_field: groupField, group_position: "first" } })}>Frequencies</button>
        <button onClick={() => call("run_collocates", { request: { ...query, sample_limit: 100 } })}>Collocates</button>
        <button onClick={() => call("run_lexicon", { request: { corpus: query.corpus, field: "pos" } })}>POS lexicon</button>
        <button onClick={() => call("run_compare", { request: { corpora: ["BROWN-LEGACY", "BNC-BABY"], field: "word", value: query.value, ignore_case: true } })}>Compare BROWN vs BNC-BABY</button>
        <button onClick={() => call("run_metadata", { request: { corpus: "CLMET", attribute: "text_genre" } })}>CLMET genres</button>
        <button onClick={() => call("run_syntax", { request: { position: 1000 } })}>EFCAM syntax @1000</button>
      </fieldset>

      <fieldset>
        <legend>Workflow / learning (example: deliver + adverb)</legend>
        <button onClick={() => call("compile_workflow_plan", { plan: DELIVER_WORKFLOW })}>Compile</button>
        <button onClick={() => call("run_workflow", { request: { plan: DELIVER_WORKFLOW, mode: "results", offset: 0, limit: 10, context: 4 } })}>Run</button>
        <button onClick={() => call("run_workflow", { request: { plan: DELIVER_WORKFLOW, mode: "group", limit: 10, group_field: "word", group_position: "last" } })}>Group last token</button>
        <button onClick={() => call("run_workflow", { request: { plan: DELIVER_WORKFLOW, mode: "sample", limit: 20, seed: 42 } })}>Random sample</button>
        <button onClick={() => call("explain_annotation", { corpus: "BNC", field: "pos", value: "VVG-AJ0" })}>Explain VVG-AJ0</button>
        <button onClick={() => call("build_guided_recipe", { input: { corpus: "BNC-BABY", mode: 2, first: "adjective", second: "noun" } })}>Guided recipe</button>
      </fieldset>

      <button onClick={() => setLog([])}>Clear console</button>
      <pre>{log.join("\n\n")}</pre>
    </div>
  );
}
