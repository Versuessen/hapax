import { Globe } from "lucide-react";
import { varietyInfo } from "../nav.js";

/*
 * Small flags drawn as SVG: flag emoji do not render on Windows (they show as
 * letter pairs), and a drawn flag looks the same on every platform. Simplified
 * for 16 px; each mark identifies the variety, it is not a decoration.
 */
const UNION = (
  <g>
    <rect width="60" height="30" fill="#012169" />
    <path d="M0 0 60 30M60 0 0 30" stroke="#fff" strokeWidth="6" />
    <path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" strokeWidth="2" />
    <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
    <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
  </g>
);
const star = (cx, cy, r, fill = "#fff") => <circle cx={cx} cy={cy} r={r} fill={fill} />;

const FLAGS = {
  GB: <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">{UNION}</svg>,
  US: (
    <svg viewBox="0 0 76 40" preserveAspectRatio="xMidYMid slice">
      <rect width="76" height="40" fill="#B22234" />
      {[1, 3, 5, 7, 9, 11].map((i) => <rect key={i} y={(40 / 13) * i} width="76" height={40 / 13} fill="#fff" />)}
      <rect width="30.4" height={(40 / 13) * 7} fill="#3C3B6E" />
    </svg>
  ),
  AU: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
      <rect width="60" height="30" fill="#012169" />
      <g transform="scale(.5)">{UNION}</g>
      {star(15, 22.5, 3)}{star(45, 7, 1.6)}{star(39, 14, 1.6)}{star(51, 12, 1.6)}{star(45, 25, 1.6)}{star(48.5, 17.5, 1)}
    </svg>
  ),
  NZ: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
      <rect width="60" height="30" fill="#012169" />
      <g transform="scale(.5)">{UNION}</g>
      {star(45, 7, 2, "#C8102E")}{star(40, 14, 2, "#C8102E")}{star(50, 13, 2, "#C8102E")}{star(45, 24, 2, "#C8102E")}
    </svg>
  ),
  CA: (
    <svg viewBox="0 0 40 20" preserveAspectRatio="xMidYMid slice">
      <rect width="40" height="20" fill="#fff" />
      <rect width="10" height="20" fill="#D52B1E" />
      <rect x="30" width="10" height="20" fill="#D52B1E" />
      <path d="M20 4 21.6 7.5 24 6.8 23 10.8 25.5 10 25 12 22 13.4 22.4 15H20.6V17.5H19.4V15H17.6L18 13.4 15 12 14.5 10 17 10.8 16 6.8 18.4 7.5Z" fill="#D52B1E" />
    </svg>
  ),
  IE: (
    <svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice">
      <rect width="1" height="2" fill="#169B62" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#FF883E" />
    </svg>
  ),
  IN: (
    <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#FF9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth=".8" />
    </svg>
  ),
};

/** Flag (or globe / ? mark) for a corpus's language variety, with an accessible label. */
export function Flag({ variety, note, size = 16 }) {
  const v = varietyInfo(variety);
  const title = note ? `${v.label} — ${note}` : v.label;
  if (v.flag && FLAGS[v.flag]) {
    return (
      <span className="flag" role="img" aria-label={v.label} title={title} style={{ width: size, height: Math.round(size * 0.7) }}>
        {FLAGS[v.flag]}
      </span>
    );
  }
  if (v.kind === "learner") {
    return <span className="flag flag--mark" role="img" aria-label={v.label} title={title} style={{ width: size, height: Math.round(size * 0.7) }}><Globe size={Math.round(size * 0.7)} strokeWidth={1.75} aria-hidden="true" /></span>;
  }
  return <span className="flag flag--mark" role="img" aria-label={v.label} title={title} style={{ width: size, height: Math.round(size * 0.7) }}>?</span>;
}
