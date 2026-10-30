// Runs synchronously in <head>, before first paint, so the window never
// flashes the wrong theme. External file because the CSP forbids inline script.
(function () {
  var pref = "system";
  try { pref = localStorage.getItem("cqp.theme") || "system"; } catch (e) {}
  var dark = pref === "dark" ||
    (pref === "system" && (!window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches));
  var root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-theme-pref", pref);
  root.style.backgroundColor = dark ? "#141414" : "#fafafa";
})();
