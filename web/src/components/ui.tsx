import type { ReactNode } from "react";

import type { ModStatus } from "../lib/types";

export const STATUS_LABEL: Record<ModStatus, string> = {
  current: "актуален",
  update_safe: "есть обновление",
  update_blocked: "обновление заблокировано",
  broken: "сломан",
  frozen: "без обновлений",
  unknown: "не разобран",
};

export const STATUS_CLASS: Record<ModStatus, string> = {
  current: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  update_safe: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  update_blocked: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  broken: "bg-red-500/15 text-red-300 ring-red-500/30",
  frozen: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
  unknown: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
};

/** Node colours in /graph must match these, so the legend works for both views. */
export const STATUS_HEX: Record<ModStatus, string> = {
  current: "#34d399",
  update_safe: "#38bdf8",
  update_blocked: "#fbbf24",
  broken: "#f87171",
  frozen: "#71717a",
  unknown: "#a78bfa",
};

export function Pill({ status }: { status: ModStatus }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-4 ring-1 ring-inset ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// Tailwind scans for literal class names, so tones are spelled out, not built
// from a template string -- an interpolated `bg-${tone}-500` would be purged.
const TAG_TONES = {
  zinc: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/20",
  sky: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
  red: "bg-red-500/10 text-red-300 ring-red-500/20",
  emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
} as const;

export function Tag({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: keyof typeof TAG_TONES;
}) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-4 ring-1 ring-inset ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-[--color-edge] bg-[--color-panel] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[--color-edge] px-4 py-2.5">
          <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={title ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "default",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
  title?: string;
}) {
  const tones = {
    default: "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 ring-zinc-700",
    primary: "bg-sky-600 hover:bg-sky-500 text-white ring-sky-500",
    danger: "bg-red-700 hover:bg-red-600 text-white ring-red-600",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded border border-[--color-edge] bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-600 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded border border-[--color-edge] bg-black/30 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-sky-600 ${props.className ?? ""}`}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-xs text-zinc-500">{children}</p>;
}

export function Loading({ what }: { what: string }) {
  return <Empty>загружаю {what}…</Empty>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-3 text-xs text-red-300">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
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
