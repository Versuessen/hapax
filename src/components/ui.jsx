import { forwardRef, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CircleAlert, Info } from "lucide-react";

export const ICON = { size: 16, strokeWidth: 1.5 };

/** Original product mark: a concordance line with its centred match. */
export function BrandMark({ className = "brand__mark" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="5.5" height="3" rx="1.5" fill="currentColor" opacity="0.38" />
      <rect x="16.5" y="4.5" width="5.5" height="3" rx="1.5" fill="currentColor" opacity="0.38" />
      <rect x="2" y="16.5" width="5.5" height="3" rx="1.5" fill="currentColor" opacity="0.38" />
      <rect x="16.5" y="16.5" width="5.5" height="3" rx="1.5" fill="currentColor" opacity="0.38" />
      <rect x="2" y="10.5" width="4" height="3" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="18" y="10.5" width="4" height="3" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="8" y="2.5" width="8" height="19" rx="4" fill="currentColor" />
    </svg>
  );
}

export function Kbd({ children, small }) {
  return <kbd className={`kbd${small ? " kbd--sm" : ""}`}>{children}</kbd>;
}

export const Button = forwardRef(function Button(
  { variant = "secondary", size, icon: IconC, children, className = "", ...rest },
  ref
) {
  const cls = ["btn", variant !== "secondary" && `btn--${variant}`, size === "lg" && "btn--lg", !children && "btn--icon", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} type="button" className={cls} {...rest}>
      {IconC && <IconC {...ICON} aria-hidden="true" />}
      {children}
    </button>
  );
});

export function IconButton({ icon, label, ...rest }) {
  return <Button variant="ghost" icon={icon} aria-label={label} title={label} {...rest} />;
}

export const Card = forwardRef(function Card({ title, sub, actions, children, className = "", flush, ...rest }, ref) {
  return (
    <section ref={ref} className={`card${flush ? " card--flush" : ""} ${className}`} {...rest}>
      {(title || actions) && (
        <header className={`card__head${flush ? " card__head--pad" : ""}`}>
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card__title">{title}</h2>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
});

export function Stat({ label, figure, unit, delta, small, onClick, ...rest }) {
  const Tag = onClick ? "button" : "section";
  return (
    <Tag
      className="card stat"
      onClick={onClick}
      style={onClick ? { textAlign: "left", font: "inherit", color: "inherit", width: "100%" } : undefined}
      {...rest}
    >
      <div className="stat__body">
        <div className="stat__label">{label}</div>
        <div className={`stat__figure${small ? " stat__figure--sm" : ""}`}>
          {figure}
          {unit && <span className="unit">{unit}</span>}
        </div>
        <div className="stat__delta">{delta}</div>
      </div>
    </Tag>
  );
}

export function Field({ label, hint, error, children, htmlFor, style }) {
  return (
    <div className="field" style={style}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <div className="field__error" role="alert">{error}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ mono, small, className = "", ...rest }, ref) {
  return <input ref={ref} className={`input${mono ? " input--mono" : ""}${small ? " input--sm" : ""} ${className}`} {...rest} />;
});

export function Select({ options, small, className = "", ...rest }) {
  return (
    <select className={`select${small ? " select--sm" : ""} ${className}`} {...rest}>
      {options.map((o) => {
        // { group, options } renders an <optgroup> of the same option shapes.
        if (o && !Array.isArray(o) && typeof o === "object" && o.group) {
          return (
            <optgroup key={`g:${o.group}`} label={o.group}>
              {o.options.map((x) => {
                const [value, label, disabled] = Array.isArray(x) ? x : [x, x, false];
                return <option key={value} value={value} disabled={disabled}>{label}</option>;
              })}
            </optgroup>
          );
        }
        const [value, label, disabled] = Array.isArray(o) ? o : [o, o, false];
        return (
          <option key={value} value={value} disabled={disabled}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, disabled, title }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented({ value, onChange, options, small, label }) {
  return (
    <div className={`segmented${small ? " segmented--sm" : ""}`} role="group" aria-label={label}>
      {options.map(([v, text, IconC]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {IconC && <IconC {...ICON} size={14} aria-hidden="true" />}
          {text}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, options, label }) {
  const ref = useRef(null);
  // Keep the selected tab visible when the row scrolls sideways (narrow windows).
  useEffect(() => {
    const el = ref.current?.querySelector('[aria-selected="true"]');
    if (el && ref.current.scrollWidth > ref.current.clientWidth) el.scrollIntoView({ block: "nearest", inline: "center" });
  }, [value]);
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref}>
      {options.map(([v, text]) => (
        <button key={v} role="tab" type="button" aria-selected={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, tone, dot, onClick, title }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag className={`chip${tone ? ` chip--${tone}` : ""}`} onClick={onClick} title={title} type={onClick ? "button" : undefined}>
      {dot && <span className="dot" style={{ background: dot }} />}
      {children}
    </Tag>
  );
}

export function Dot({ color }) {
  return <span className="dot" style={{ background: color, color }} aria-hidden="true" />;
}

export function EmptyState({ icon: IconC, title, children, action, center }) {
  return (
    <div className={`empty${center ? " empty--center" : ""}`}>
      {IconC && (
        <div className="empty__icon">
          <IconC {...ICON} aria-hidden="true" />
        </div>
      )}
      <div className="empty__title">{title}</div>
      {children && <div className="empty__text">{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }) {
  const IconC = tone === "warn" ? AlertTriangle : tone === "neg" ? CircleAlert : Info;
  return (
    <div className={`notice notice--${tone}`} role={tone === "neg" ? "alert" : "note"}>
      <IconC {...ICON} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = "Working" }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

/** Modal dialog rendered in a portal, with Esc-to-close and focus containment. */
export function Dialog({ open, onClose, title, text, children, footer, wide, className = "", labelledBy }) {
  const ref = useRef(null);
  const titleId = useId();
  // Keep the latest onClose without re-running the focus effect on every
  // render (otherwise each keystroke would pull focus back to the first field).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const el = ref.current;
    // data-autofocus lets a dialog pick its starting field (React's autoFocus leaves no attribute).
    const first = el?.querySelector("[data-autofocus]") || el?.querySelector("[autofocus], input, select, textarea, button");
    first?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current?.();
      }
      if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled);
        if (!items.length) return;
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    el?.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        className={`dialog${wide ? " dialog--wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
      >
        {title && (
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
        )}
        {text && <p className="dialog__text">{text}</p>}
        {children}
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/**
 * Closes a popup on an outside click or Escape; Escape returns focus to the
 * trigger. The one implementation for menus, pickers and suggestion lists.
 */
export function useDismiss(open, setOpen, ref, triggerRef) {
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef?.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A result table that scrolls inside its card: keyboard-focusable region
 * with an accessible name and a maximum height.
 */
export function ScrollTable({ label, max = 520, children, bordered = true, style }) {
  return (
    <div tabIndex={0} role="region" aria-label={label} className="table-wrap table-scroll"
      style={{ "--table-max": `${max}px`, ...(bordered ? { borderTop: "1px solid var(--border-subtle)" } : {}), ...style }}>
      <table className="table">{children}</table>
    </div>
  );
}

/**
 * Views of one workspace (Search result views, Corpora views): a tablist that
 * switches screen ids, with the shortcut shown in each tab's title.
 */
export function ViewTabs({ base, views, current, onChange, label, keyHint = true }) {
  const ref = useRef(null);
  const onKey = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = views.findIndex((v) => v.id === current);
    const n = e.key === "Home" ? 0 : e.key === "End" ? views.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    onChange(`${base}/${views[n].id}`);
    setTimeout(() => ref.current?.querySelector('[aria-selected="true"]')?.focus(), 0);
  };
  return (
    <div className="tabs view-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {views.map((v, i) => (
        <button key={v.id} role="tab" type="button" id={`tab-${base}-${v.id}`} aria-selected={current === v.id} tabIndex={current === v.id ? 0 : -1}
          title={keyHint ? `${v.label} (Ctrl+${i + 1})` : v.label} onClick={() => onChange(`${base}/${v.id}`)}>
          {v.label}{v.badge != null && <span className="view-tabs__badge">{v.badge}</span>}
        </button>
      ))}
    </div>
  );
}
