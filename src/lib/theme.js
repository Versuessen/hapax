import { useCallback, useEffect, useState } from "react";
import { setNativeTheme } from "./ipc.js";

const KEY = "cqp.theme";
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");

export function readThemePref() {
  try {
    return localStorage.getItem(KEY) || "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref) {
  if (pref === "dark" || pref === "light") return pref;
  return media()?.matches === false ? "light" : "dark";
}

function apply(pref) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-pref", pref);
  root.style.backgroundColor = "";
  // Windows 11 / KDE title bar follows the app theme ("null" = follow system).
  setNativeTheme(pref === "system" ? null : resolved);
  return resolved;
}

/** Theme preference: "system" | "dark" | "light"; persisted, applied pre-paint by /theme-init.js. */
export function useTheme(onPersist) {
  const [pref, setPrefState] = useState(readThemePref);
  const [resolved, setResolved] = useState(() => resolveTheme(readThemePref()));

  useEffect(() => {
    setResolved(apply(pref));
    if (pref !== "system") return;
    const m = media();
    if (!m) return;
    const onChange = () => setResolved(apply("system"));
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = useCallback(
    (next) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage unavailable: theme still applies for this session */
      }
      setPrefState(next);
      onPersist?.(next);
    },
    [onPersist]
  );

  return { pref, resolved, setPref };
}
