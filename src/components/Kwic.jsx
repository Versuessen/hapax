import { useEffect, useRef } from "react";
import { thousands } from "../lib/format.js";

/**
 * Centred KWIC: left context right-aligned against the highlighted match,
 * right context left-aligned (handoff doc 06). Arrow keys move the selection.
 */
export function Kwic({ rows, offset = 0, selected, onSelect, onOpen, label = "Concordance lines" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (selected == null) return;
    ref.current?.querySelector(`[data-i="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  if (!rows?.length) return null;
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); onSelect?.(Math.min(rows.length - 1, (selected ?? -1) + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); onSelect?.(Math.max(0, (selected ?? 1) - 1)); }
    if (e.key === "Enter" && selected != null) onOpen?.(selected);
  };
  return (
    <div className="kwic" role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey} ref={ref}>
      {rows.map((r, i) => (
        <div
          key={`${r.start}-${r.end}-${i}`}
          data-i={i}
          className="kwic__row"
          role="option"
          aria-selected={selected === i}
          onClick={() => onSelect?.(i)}
          onDoubleClick={() => onOpen?.(i)}
        >
          <span className="kwic__n">{thousands(offset + i + 1)}</span>
          <span className="kwic__left"><span>{r.left}</span></span>
          <mark className="kwic__match">{r.text}</mark>
          <span className="kwic__right">{r.right}</span>
          <span className="kwic__src" title="Source document / file">{r.source ?? ""}</span>
        </div>
      ))}
    </div>
  );
}
