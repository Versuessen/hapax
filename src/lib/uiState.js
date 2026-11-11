/**
 * Remembered interface state for this viewer: last screen and views, view
 * settings, panel choices. One JSON object in localStorage; every access is
 * guarded, so private windows or blocked storage just start with defaults.
 */
const KEY = "hapax.ui";
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { cache = {}; }
  return cache;
}

export const ui = {
  get(k, fallback) {
    const v = load()[k];
    return v === undefined ? fallback : v;
  },
  set(k, v) {
    const c = load();
    if (c[k] === v) return;
    c[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* defaults next time */ }
  },
};
