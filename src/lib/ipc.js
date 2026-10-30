// Single gateway to the Rust backend.
//
// - Inside the Tauri window: real `invoke` / `listen` / native dialogs.
// - In a plain browser during `vite dev` only: the deterministic fixture
//   backend in src/dev/fixtures.js (used for visual comparison screenshots).
//   `import.meta.env.DEV` is false in production builds, so the fixtures are
//   tree-shaken out and can never replace live behaviour in the shipped app.

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let backendPromise = null;

function loadBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (inTauri) {
      const [core, event, dialog, opener, win] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-opener"),
        import("@tauri-apps/api/window"),
      ]);
      return {
        kind: "tauri",
        invoke: core.invoke,
        listen: event.listen,
        save: dialog.save,
        open: dialog.open,
        openUrl: opener.openUrl,
        setTheme: (t) => win.getCurrentWindow().setTheme(t).catch(() => {}),
      };
    }
    if (import.meta.env.DEV) {
      const { createFixtureBackend } = await import("../dev/fixtures.js");
      return createFixtureBackend();
    }
    const unavailable = async () => {
      throw { kind: "io", message: "This build must run inside the Hapax desktop window." };
    };
    return {
      kind: "none",
      invoke: unavailable,
      listen: async () => () => {},
      save: async () => null,
      open: async () => null,
      openUrl: async (u) => window.open(u, "_blank", "noopener"),
      setTheme: async () => {},
    };
  })();
  return backendPromise;
}

/** Normalize anything thrown into the backend's `{ kind, message }` shape. */
export function toAppError(err) {
  if (err && typeof err === "object" && "message" in err && "kind" in err) return err;
  if (typeof err === "string") return { kind: "unknown", message: err };
  return { kind: "unknown", message: err?.message || String(err) };
}

export async function invoke(cmd, args = {}) {
  const b = await loadBackend();
  try {
    return await b.invoke(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export async function listen(event, handler) {
  const b = await loadBackend();
  return b.listen(event, handler);
}

const TABLE_FILTERS = [
  { name: "CSV for Excel", extensions: ["csv"] },
  { name: "Tab-separated", extensions: ["tsv"] },
  { name: "JSON", extensions: ["json"] },
];

export async function saveDialog({ defaultPath, filters = TABLE_FILTERS, title } = {}) {
  const b = await loadBackend();
  return b.save({ defaultPath, filters, title });
}

export async function openDialog({ filters, title } = {}) {
  const b = await loadBackend();
  return b.open({ multiple: false, directory: false, filters, title });
}

export async function openExternal(url) {
  const b = await loadBackend();
  return b.openUrl(url);
}

export async function setNativeTheme(theme) {
  const b = await loadBackend();
  return b.setTheme(theme);
}

export async function backendKind() {
  return (await loadBackend()).kind;
}

export const JSON_FILTERS = [{ name: "JSON", extensions: ["json"] }];
