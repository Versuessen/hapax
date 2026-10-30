// Self-update from GitHub Releases (tauri-plugin-updater).
//
// Every push to `main` makes CI build signed installers and publish
// `latest.json`. On start-up Hapax asks for that file once; the plugin checks
// the signature against the public key compiled into the app before anything
// is installed. Fixture/dev mode simulates an update with `?update=1`.

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * @returns {Promise<null | { version: string, current: string, notes: string, date: string | null,
 *   install: (onProgress?: (fraction: number | null) => void) => Promise<void> }>}
 */
export async function checkForUpdate() {
  if (inTauri) {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 15000 });
    if (!update) return null;
    return {
      version: update.version,
      current: update.currentVersion,
      notes: update.body || "",
      date: update.date || null,
      install: async (onProgress) => {
        let total = 0, got = 0;
        await update.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength || 0;
          else if (e.event === "Progress") { got += e.data.chunkLength; onProgress?.(total ? got / total : null); }
          else if (e.event === "Finished") onProgress?.(1);
        });
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("update") === "1") {
    return {
      version: "1.0.42",
      current: "1.0.0",
      notes: "- Add spread-across-texts view\n- Fix sorting when paging backwards\n- Corpus list is checked against the server on connect",
      date: new Date().toISOString(),
      install: async (onProgress) => {
        for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 120)); onProgress?.(i / 10); }
      },
    };
  }
  return null;
}
