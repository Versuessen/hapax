const nf = new Intl.NumberFormat("en-US");

export const thousands = (n) => (n == null || Number.isNaN(n) ? "—" : nf.format(n));

/** 112156361 -> "112M", 4644834 -> "4.6M", 20699 -> "20.7k" (mono counts in lists). */
export function compact(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const fmt = (v, s) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "k");
  return String(n);
}

export const perMillion = (count, tokens) => (tokens ? (count * 1e6) / tokens : 0);

export function rate(x) {
  return x >= 100 ? nf.format(Math.round(x)) : x.toFixed(2);
}

export function seconds(s) {
  if (s == null) return "—";
  return s < 10 ? `${s.toFixed(2)} s` : `${s.toFixed(1)} s`;
}

export const pad2 = (n) => String(n).padStart(2, "0");

export function plural(n, one, many = `${one}s`) {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}

export function utcStamp() {
  return new Date().toISOString().replace(/[:]/g, "").slice(0, 15);
}

export function safeFileStem(s) {
  return String(s || "export").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
}
