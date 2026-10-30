const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isMac = /Mac OS X|Macintosh/.test(ua) && !/Windows|Linux/.test(ua);

/** Modifier keycap label shown in the search field ("⌘" on macOS, "Ctrl" elsewhere). */
export const modKey = isMac ? "⌘" : "Ctrl";

export const isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
