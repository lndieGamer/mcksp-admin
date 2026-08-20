import { forwardRef, type ReactNode } from "react";

import type { ModStatus } from "../lib/types";

export const STATUS_LABEL: Record<ModStatus, string> = {
  current: "актуален",
  update_safe: "есть обновление",
  update_blocked: "обновление заблокировано",
  broken: "сломан",
  frozen: "без обновлений",
  unknown: "не разобран",
};

/* Status never rides on colour alone: the glyph carries the same information,
   which is what makes the table readable in peripheral vision and to anyone
   who cannot separate rust from patina. */
export const STATUS_GLYPH: Record<ModStatus, string> = {
  current: "●",
  update_safe: "▲",
  update_blocked: "⊘",
  broken: "✕",
  frozen: "◇",
  unknown: "◻",
};

export const STATUS_CLASS: Record<ModStatus, string> = {
  current: "text-muted",
  update_safe: "text-accent",
  update_blocked: "text-warn",
  broken: "text-danger",
  frozen: "text-faint",
  // 148 mods sit here whenever the CurseForge key is missing. Brass would paint
  // the whole screen; an unresolved parse is a gap in our data, not a fault in
  // the pack, and the banner already explains it.
  unknown: "text-faint",
};

/** Cytoscape cannot read CSS variables, so /graph needs the resolved values.
 *  Measured from the OKLCH tokens in index.css -- keep the two in step. */
export const STATUS_HEX: Record<ModStatus, string> = {
  current: "#acb3b2",
  update_safe: "#63b6a7",
  update_blocked: "#e8aa4e",
  broken: "#d55753",
  frozen: "#7b8282",
  unknown: "#7b8282",
};

/** Node fill on /graph: the status hue mixed 16% into the canvas. Cytoscape
 *  compositing a saturated hex at low opacity turns the same colours to mud,
 *  so the blend is resolved here instead. */
export const STATUS_FILL: Record<ModStatus, string> = {
  current: "#222827",
  update_safe: "#172826",
  update_blocked: "#2c2617",
  broken: "#291918",
  frozen: "#1a2020",
  unknown: "#1a2020",
};

export const PALETTE_HEX = {
  canvas: "#080d0d",
  surface: "#111817",
  raised: "#1a2222",
  edge: "#273030",
  edgeStrong: "#3a4545",
  ink: "#e8ecec",
  muted: "#acb3b2",
  faint: "#7b8282",
  accent: "#63b6a7",
  danger: "#d55753",
  warn: "#e8aa4e",
} as const;

export function StatusMark({ status, label = true }: { status: ModStatus; label?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${STATUS_CLASS[status]}`}>
      <span aria-hidden className="text-2xs leading-none">
        {STATUS_GLYPH[status]}
      </span>
      {label ? <span className="text-xs">{STATUS_LABEL[status]}</span> : null}
      {label ? null : <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  );
}

/** Kept for call sites that want the status inline in a dense row. */
export const Pill = StatusMark;

// Tailwind scans for literal class names, so tones are spelled out rather than
// built from a template -- an interpolated `bg-${tone}` would be purged.
const TAG_TONES = {
  neutral: "text-muted ring-edge",
  accent: "text-accent ring-accent-dim",
  warn: "text-warn ring-warn-dim",
  danger: "text-danger ring-danger-dim",
} as const;

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TAG_TONES;
}) {
  return (
    <span
      className={`inline-block rounded-xs px-1.5 py-0.5 text-xs leading-4 ring-1 ring-inset ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Section heading inside the overview. The one place caps-with-tracking is
 *  allowed, because it separates bands of a single scrolling page. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-2xs font-medium tracking-[0.12em] text-faint uppercase">{children}</h2>
  );
}

/** Every screen sits inside one of these. `scroll` false hands the page the full
 *  viewport height so it can pin its own toolbar and let only the rows move --
 *  which is what makes a sticky table head work without a hard-coded offset. */
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div className={`h-full ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>
      <div
        className={`mx-auto flex max-w-[1600px] flex-col gap-4 px-6 py-5 ${
          scroll ? "" : "h-full min-h-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** The heading band of a screen. Tables sit straight on the canvas now, so the
 *  title, the count and the rule under them are what says "this is one block" --
 *  a bordered box around every table was the reason eight screens looked alike. */
export function PageTitle({
  children,
  count,
  actions,
}: {
  children: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-edge pb-2">
      <h1 className="text-xl font-medium tracking-[-0.01em] text-ink">{children}</h1>
      {count != null && <span className="font-mono text-sm text-faint">{count}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Sub-band inside a screen that carries more than one table. */
export function Band({
  title,
  count,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-md font-medium text-ink">{title}</h2>
        {count != null && <span className="font-mono text-sm text-faint">{count}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Column heading. Lower case on purpose: caps-with-tracking is reserved for the
 *  overview's section dividers and nowhere else. */
export function Th({
  children,
  align = "left",
  className = "",
  onClick,
  sorted,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  onClick?: () => void;
  sorted?: "asc" | "desc" | false;
}) {
  const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
  return (
    <th
      scope="col"
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
      onClick={onClick}
      className={`px-2 pb-1.5 text-xs font-medium text-faint ${ALIGN[align]} ${
        onClick ? "cursor-pointer select-none hover:text-ink" : ""
      } ${className}`}
    >
      {children}
      {sorted && <span className="ml-1 text-accent">{sorted === "desc" ? "▾" : "▴"}</span>}
    </th>
  );
}

const BUTTON_TONES = {
  ghost: "border-edge bg-transparent text-ink hover:border-edge-strong hover:bg-raised",
  primary:
    "border-accent bg-accent text-on-accent hover:border-accent-strong hover:bg-accent-strong",
  danger: "border-danger-dim bg-transparent text-danger hover:border-danger hover:bg-danger/10",
} as const;

export function Button({
  children,
  onClick,
  disabled,
  loading = false,
  tone = "ghost",
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: keyof typeof BUTTON_TONES;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-sm border px-3 text-xs font-medium transition-colors duration-[--dur-fast] ease-quint active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 ${BUTTON_TONES[tone]} ${className}`}
    >
      {loading ? (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {children}
    </button>
  );
}

const FIELD =
  "h-[30px] rounded-sm border border-edge bg-canvas px-2 text-xs text-ink transition-colors duration-[--dur-fast] placeholder:text-faint hover:border-edge-strong focus:border-accent focus:outline-none";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`${FIELD} ${props.className ?? ""}`} />;
  },
);

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} ${props.className ?? ""}`} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-xs border border-edge bg-raised px-1 py-px text-2xs text-muted">
      {children}
    </kbd>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-faint">{children}</p>;
}

/** Skeletons take the shape of what is coming, so the page does not jump. */
export function Skeleton({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-1.5 p-3 ${className}`} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-6 animate-pulse rounded-xs bg-raised"
          style={{ animationDelay: `${i * 70}ms`, opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}

export function Loading({ what, rows = 6 }: { what: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">загружаю {what}</span>
      <Skeleton rows={rows} />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-sm border border-danger-dim bg-danger/10 px-3 py-2 text-xs text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** Russian counts need three forms, and "4 ошибок" is the tell that a UI was
 *  translated rather than written. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function bytes(value: number): string {
  if (!value) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function day(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

export function stamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

/** "12 минут назад" reads faster than a timestamp for the freshness line. */
export function ago(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}
