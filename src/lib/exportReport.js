import { thousands } from "./format.js";

/** Run an export and report the outcome as a toast (and in the session log). */
export async function exportReport(toast, log, label, promise) {
  try {
    const r = await promise;
    if (!r) return;
    const msg = typeof r === "string" ? `Saved ${r}` : `Saved ${thousands(r.rows)} rows${r.total != null ? ` of ${thousands(r.total)}` : ""} · ${r.path}${r.provenance_path ? " (+ provenance)" : ""}`;
    toast(msg, "positive", 7000);
    log?.({ label, detail: typeof r === "string" ? "saved" : `${thousands(r.rows)} rows` });
    return true;
  } catch (e) {
    toast(e.message, "negative", 9000);
    return false;
  }
}
