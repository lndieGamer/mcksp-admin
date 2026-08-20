import {
  CircleArrowUp,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  CircleX,
  Globe,
  Monitor,
  Server,
  Snowflake,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import type { ModStatus, Side } from "../lib/types";

export const STATUS_LABEL: Record<ModStatus, string> = {
  current: "актуален",
  update_safe: "есть обновление",
  update_blocked: "обновление заблокировано",
  broken: "сломан",
  frozen: "без обновлений",
  unknown: "не разобран",
};

/* Status never rides on colour alone: the icon carries the same information,
   which is what makes the table readable in peripheral vision and to anyone
   who cannot separate rust from patina. */
export const STATUS_ICON: Record<ModStatus, LucideIcon> = {
  current: CircleCheck,
  update_safe: CircleArrowUp,
  update_blocked: CircleSlash,
  broken: CircleX,
  frozen: Snowflake,
  unknown: CircleHelp,
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

/** Резолвнутые значения токенов: их читает SVG рёбер графа и inline-стили,
 *  куда CSS-переменную не подставить. Держать в шаге с index.css. */
export const STATUS_HEX: Record<ModStatus, string> = {
  current: "#acb3b2",
  update_safe: "#63b6a7",
  update_blocked: "#e8aa4e",
  broken: "#d55753",
  frozen: "#7b8282",
  unknown: "#7b8282",
};

export const SIDE_LABEL: Record<Side, string> = {
  both: "клиент и сервер",
  client: "только клиент",
  server: "только сервер",
};

export const SIDE_ICON: Record<Side, LucideIcon> = {
  both: Globe,
  client: Monitor,
  server: Server,
};

/** Цвет узла в графе несёт side. Тройка проверена на различимость при
 *  протан/дейтеран/тританопии — подробности в комментарии у токенов
 *  --color-side-* в index.css. Держать в шаге с ними. */
export const SIDE_HEX: Record<Side, string> = {
  both: "#4dc1ab",
  client: "#4495ea",
  server: "#faabf3",
};

export function StatusMark({
  status,
  label = true,
  size = 14,
}: {
  status: ModStatus;
  label?: boolean;
  size?: number;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${STATUS_CLASS[status]}`}>
      <Icon aria-hidden size={size} strokeWidth={1.75} className="shrink-0" />
      {label ? <span className="text-xs">{STATUS_LABEL[status]}</span> : null}
      {label ? null : <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  );
}

/** Kept for call sites that want the status inline in a dense row. */
export const Pill = StatusMark;

const SIDE_CLASS: Record<Side, string> = {
  both: "text-side-both ring-side-both-dim",
  client: "text-side-client ring-side-client-dim",
  server: "text-side-server ring-side-server-dim",
};

export function SideMark({ side, label = false }: { side: Side; label?: boolean }) {
  const Icon = SIDE_ICON[side];
  return (
    <span
      title={SIDE_LABEL[side]}
      className={`inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 font-mono text-2xs ring-1 ring-inset ${SIDE_CLASS[side]}`}
    >
      <Icon aria-hidden size={12} strokeWidth={1.75} />
      {label ? side : <span className="sr-only">{SIDE_LABEL[side]}</span>}
    </span>
  );
}

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
      className={`inline-block rounded-xs px-2 py-0.5 text-2xs leading-5 ring-1 ring-inset ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Section heading inside the overview. The one place caps-with-tracking is
 *  allowed, because it separates bands of a single scrolling page. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-2xs font-medium tracking-[0.14em] text-faint uppercase">
      {children}
    </h2>
  );
}

/** Поверхность. Одна лестница высоты на всю систему: карточка — e2 с верхним
 *  бликом, всплывающее — e3, оверлей — e4. */
export function Card({
  children,
  className = "",
  interactive = false,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  glow?: boolean;
}) {
  return (
    <div
      className={`lit relative rounded-md border border-edge bg-gradient-to-b from-surface to-canvas/60 ${
        interactive
          ? "transition-[border-color,transform,box-shadow] duration-[var(--dur)] ease-quint hover:-translate-y-0.5 hover:border-edge-strong hover:shadow-[var(--shadow-e3)]"
          : ""
      } ${glow ? "shadow-[var(--shadow-glow)]" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: LucideIcon;
}

/** Одна полоса состава: 214 модов, разложенные по статусу или по side.
 *  Сегменты разделены двухпиксельным просветом фона, а не рамкой — иначе на
 *  доле в 1% сегмент состоит из одной рамки. Значение подписано и в легенде,
 *  и в подсказке: цвет здесь не единственный носитель. */
export function DistBar({
  segments,
  total,
  height = 14,
}: {
  segments: Segment[];
  total: number;
  height?: number;
}) {
  const shown = segments.filter((segment) => segment.value > 0);
  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={shown.map((s) => `${s.label}: ${s.value}`).join(", ")}
        className="flex w-full gap-[2px] overflow-hidden rounded-full"
        style={{ height }}
      >
        {shown.map((segment) => (
          <span
            key={segment.key}
            title={`${segment.label}: ${segment.value} (${Math.round((segment.value / total) * 100)}%)`}
            className="h-full min-w-[3px] transition-[flex-grow,opacity] duration-[var(--dur-slow)] ease-quint first:rounded-l-full last:rounded-r-full hover:opacity-80"
            style={{ flexGrow: segment.value, background: segment.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {shown.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2 text-2xs text-faint">
            {segment.icon ? (
              <segment.icon
                aria-hidden
                size={12}
                strokeWidth={1.75}
                style={{ color: segment.color }}
              />
            ) : (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: segment.color }}
              />
            )}
            {segment.label}
            <span className="font-mono text-muted">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every screen sits inside one of these. `scroll` false hands the page the full
 *  viewport height so it can pin its own toolbar and let only the rows move. */
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div className={`page-enter h-full ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>
      <div
        className={`mx-auto flex max-w-[1720px] flex-col gap-6 px-8 py-7 ${
          scroll ? "" : "h-full min-h-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** The heading band of a screen. */
export function PageTitle({
  children,
  count,
  actions,
  icon: Icon,
}: {
  children: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge pb-4">
      {Icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-raised text-accent ring-1 ring-edge ring-inset">
          <Icon aria-hidden size={18} strokeWidth={1.75} />
        </span>
      )}
      <h1 className="text-xl font-semibold text-ink">{children}</h1>
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
    <section className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-md font-semibold text-ink">{title}</h2>
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
      className={`px-3 pb-2.5 text-xs font-medium text-faint ${ALIGN[align]} ${
        onClick
          ? "cursor-pointer transition-colors duration-[var(--dur-fast)] select-none hover:text-ink"
          : ""
      } ${className}`}
    >
      {children}
      {sorted && <span className="ml-1 text-accent">{sorted === "desc" ? "▾" : "▴"}</span>}
    </th>
  );
}

const BUTTON_TONES = {
  ghost:
    "border-edge bg-raised/40 text-ink hover:border-edge-strong hover:bg-raised hover:shadow-[var(--shadow-e2)]",
  primary:
    "border-accent bg-accent text-on-accent hover:border-accent-strong hover:bg-accent-strong hover:shadow-[var(--shadow-glow)]",
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
  icon: Icon,
}: {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: keyof typeof BUTTON_TONES;
  type?: "button" | "submit";
  title?: string;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm border px-4 text-xs font-medium transition-[background-color,border-color,box-shadow,transform] duration-[var(--dur)] ease-quint active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${BUTTON_TONES[tone]} ${className}`}
    >
      {loading ? (
        <span aria-hidden className="pulse-ring size-1.5 rounded-full bg-current" />
      ) : Icon ? (
        <Icon aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
      ) : null}
      {children}
    </button>
  );
}

/** Сегментный переключатель: два-четыре взаимоисключающих режима. Подложка
 *  активного сегмента едет между позициями, а не мигает. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-sm border border-edge bg-canvas/60 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xs px-3 text-2xs font-medium transition-colors duration-[var(--dur)] ${
              active
                ? "bg-raised text-ink shadow-[var(--shadow-e1)]"
                : "text-faint hover:bg-raised/50 hover:text-muted"
            }`}
          >
            {Icon && <Icon aria-hidden size={13} strokeWidth={1.75} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const FIELD =
  "h-10 rounded-sm border border-edge bg-canvas/70 px-3 text-xs text-ink transition-[border-color,box-shadow] duration-[var(--dur)] placeholder:text-faint hover:border-edge-strong focus:border-accent focus:shadow-[var(--shadow-glow)] focus:outline-none";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`${FIELD} ${props.className ?? ""}`} />;
  },
);

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} cursor-pointer ${props.className ?? ""}`} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-xs border border-edge bg-raised px-1.5 py-0.5 font-mono text-2xs text-muted">
      {children}
    </kbd>
  );
}

export function Empty({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="fade-in flex flex-col items-center gap-3 px-4 py-14 text-center">
      {Icon && (
        <span className="grid size-11 place-items-center rounded-md bg-raised/60 text-faint ring-1 ring-edge ring-inset">
          <Icon aria-hidden size={20} strokeWidth={1.5} />
        </span>
      )}
      <p className="text-sm text-faint">{children}</p>
    </div>
  );
}

/** Skeletons take the shape of what is coming, so the page does not jump. */
export function Skeleton({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 p-4 ${className}`} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="shimmer h-9 rounded-sm bg-raised/70"
          style={{ animationDelay: `${i * 90}ms`, opacity: 1 - i * 0.09 }}
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
    <div className="rounded-sm border border-danger-dim bg-danger/10 px-4 py-3 text-xs text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** Иконка мода. Modrinth раздаёт её по project_id; CurseForge через прокси не
 *  ходит, поэтому там сразу детерминированная заглушка из slug. */
export function ModIcon({
  slug,
  projectId,
  source,
  size = 28,
}: {
  slug: string;
  projectId?: string | null;
  source?: string | null;
  size?: number;
}) {
  const url =
    source === "modrinth" && projectId
      ? `https://cdn.modrinth.com/data/${projectId}/icon.png`
      : null;
  // Хеш slug'а в оттенок: заглушки различимы между собой и стабильны от сборки
  // к сборке, в отличие от случайного цвета.
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) % 360;
  const initials = slug
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-xs ring-1 ring-edge ring-inset"
      style={{
        width: size,
        height: size,
        background: `oklch(0.28 0.04 ${hash})`,
        color: `oklch(0.86 0.06 ${hash})`,
      }}
    >
      <span className="font-mono leading-none" style={{ fontSize: size * 0.36 }}>
        {initials || "?"}
      </span>
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          className="absolute inset-0 size-full object-cover"
          // Битая иконка оставляет под собой заглушку вместо сломанной картинки.
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
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
