import { useEffect, useMemo, useRef, useState } from "react";
import { compact, thousands } from "../lib/format.js";

/** Accent palette in reference order. CSS variables, so both themes work. */
export const SERIES = ["var(--accent-yellow)", "var(--accent-green)", "var(--accent-blue)", "var(--accent-pink)", "var(--accent-violet)"];

function useWidth(ref) {
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Monotone cubic (Fritsch–Carlson): smooth like the reference, never overshoots data. */
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    dy.push(pts[i + 1][1] - pts[i][1]);
    m.push(dy[i] / dx[i]);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** Round step so that `intervals` gridlines cover v with tidy labels (0/40k/80k…). */
function niceScale(v, intervals) {
  const raw = Math.max(v, 1) / intervals;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const s = step < 1 ? 1 : step;
  return { max: s * intervals, ticks: Array.from({ length: intervals + 1 }, (_, i) => i * s) };
}

/**
 * Multi-series line chart in the reference style.
 * series: [{ name, values, color }], mirrored: same shape drawn below a
 * second baseline in the neutral colour (the reference's grey lower panel).
 */
export function LineChart({ labels, series, mirrored, height = 220, mirroredHeight = 120, markIndex, markLabel, ariaLabel }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const [hover, setHover] = useState(null);

  const geom = useMemo(() => {
    const padL = 44, padR = 12, top = 10, gapAxis = 27;
    const plotW = width - padL - padR;
    const up = niceScale(Math.max(1, ...series.flatMap((s) => s.values)), 4);
    const down = niceScale(mirrored?.length ? Math.max(1, ...mirrored.flatMap((s) => s.values)) : 1, 3);
    const maxUp = up.max, maxDown = mirrored?.length ? down.max : 0;
    const x = (i) => padL + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
    const base = top + height;
    const yUp = (v) => base - (v / maxUp) * height;
    const base2 = base + gapAxis;
    const yDown = (v) => base2 + (v / (maxDown || 1)) * mirroredHeight;
    const total = base2 + (mirrored?.length ? mirroredHeight + 8 : 0);
    return { padL, padR, x, yUp, yDown, base, base2, maxUp, maxDown, total, plotW, ticksUp: up.ticks, ticksDown: down.ticks };
  }, [width, labels.length, series, mirrored, height, mirroredHeight]);

  const { ticksUp, ticksDown } = geom;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    let best = 0, bestD = Infinity;
    labels.forEach((_, i) => {
      const d = Math.abs(geom.x(i) - px);
      if (d < bestD) [best, bestD] = [i, d];
    });
    setHover(best);
  };
  const onKey = (e) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(labels.length - 1, (h ?? -1) + 1));
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? labels.length) - 1));
    if (e.key === "Escape") setHover(null);
  };

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        className="chart"
        width={width}
        height={geom.total}
        viewBox={`0 0 ${width} ${geom.total}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? 0)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ticksUp.map((t) => (
          <g key={`u${t}`}>
            <line className="grid-line" x1={geom.padL} x2={width - geom.padR} y1={geom.yUp(t)} y2={geom.yUp(t)} />
            <text x={geom.padL - 10} y={geom.yUp(t) + 4} textAnchor="end">{compact(Math.round(t))}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l + i} x={geom.x(i)} y={geom.base + 20} textAnchor="middle">{l}</text>
        ))}
        {markIndex != null && (
          <g>
            <line className="node-line" x1={geom.x(markIndex)} x2={geom.x(markIndex)} y1={geom.yUp(geom.maxUp)} y2={geom.base} />
            {markLabel && <text x={geom.x(markIndex)} y={geom.yUp(geom.maxUp) - 2} textAnchor="middle" style={{ fill: "var(--text-2)" }}>{markLabel}</text>}
          </g>
        )}
        {[...series].reverse().map((s) => {
          const d = monotonePath(s.values.map((v, i) => [geom.x(i), geom.yUp(v)]));
          return (
            <g key={s.name}>
              <path className="series series--glow" d={d} style={{ stroke: s.color }} />
              <path className="series" d={d} style={{ stroke: s.color }} />
            </g>
          );
        })}
        {mirrored?.length > 0 && (
          <g>
            {ticksDown.map((t) => (
              <g key={`d${t}`}>
                <line className="grid-line" x1={geom.padL} x2={width - geom.padR} y1={geom.yDown(t)} y2={geom.yDown(t)} />
                <text x={geom.padL - 10} y={geom.yDown(t) + 4} textAnchor="end">{compact(Math.round(t))}</text>
              </g>
            ))}
            {mirrored.map((s) => (
              <path key={s.name} className="series series--neutral" d={monotonePath(s.values.map((v, i) => [geom.x(i), geom.yDown(v)]))} />
            ))}
          </g>
        )}
        {hover != null && <line className="hover-line" x1={geom.x(hover)} x2={geom.x(hover)} y1={geom.yUp(geom.maxUp)} y2={geom.total - 8} />}
      </svg>
      {hover != null && (
        <div
          className="chart-tip"
          style={{ left: Math.min(Math.max(0, geom.x(hover) + 14), width - 170), top: 8 }}
          role="status"
        >
          <div className="chart-tip__title">{labels[hover]}</div>
          {series.map((s) => (
            <div className="chart-tip__row" key={s.name}>
              <span className="dot" style={{ background: s.color, width: 7, height: 7, boxShadow: "none" }} />
              {s.name}
              <b>{thousands(s.values[hover])}</b>
            </div>
          ))}
          {mirrored?.map((s) => (
            <div className="chart-tip__row" key={s.name} style={{ color: "var(--text-3)" }}>
              <span className="dot" style={{ background: "var(--chart-neutral)", width: 7, height: 7, boxShadow: "none" }} />
              {s.name}
              <b style={{ color: "var(--text-2)" }}>{thousands(s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="legend__item" key={i.name}>
          <span className="dot" style={{ background: i.color, color: i.color }} />
          {i.name}
          {i.meta != null && <span className="mono">{i.meta}</span>}
        </span>
      ))}
    </div>
  );
}

/** Thin, glowing horizontal bars for frequency tables (replaces fat bars). */
export function BarCell({ value, max, color = "var(--accent-blue)" }) {
  const pct = max ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="bar-cell">
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ width: `${pct}%`, "--bar": color }} />
      </div>
    </div>
  );
}
