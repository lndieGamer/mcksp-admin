import {
  ArrowRight,
  Boxes,
  CircleCheck,
  HardDrive,
  LayoutGrid,
  Network,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  Card,
  DistBar,
  Loading,
  Page,
  PageTitle,
  SIDE_HEX,
  SIDE_ICON,
  SIDE_LABEL,
  STATUS_HEX,
  STATUS_ICON,
  STATUS_LABEL,
  SectionLabel,
  ago,
  bytes,
  plural,
  stamp,
  type Segment,
} from "../components/ui";
import { loginUrl, workerConfigured } from "../lib/api";
import { usePrivate, usePublic, useSession } from "../lib/data";
import { isolatedSlugs } from "../lib/graph";
import type { ModStatus, Side } from "../lib/types";

interface Item {
  icon: LucideIcon;
  tone: string;
  text: string;
  to: string;
  cta: string;
}

/** Экран отвечает на вопрос «всё ли в порядке», поэтому это очередь решений, а
 *  не стена метрик. Пустая очередь — тоже ответ, и он должен выглядеть как
 *  ответ, а не как пустое место. */
export default function Overview() {
  const publicData = usePublic();
  const privateData = usePrivate();
  const session = useSession();
  const admin = Boolean(session.data);

  if (publicData.isLoading) return <Loading what="сводку" rows={8} />;
  const data = publicData.data;
  if (!data) return null;

  const priv = privateData.data;
  const items: Item[] = [];

  if (priv) {
    const errors = priv.lint.filter((f) => f.level === "error");
    const warnings = priv.lint.filter((f) => f.level === "warning");
    const blocked = priv.updates.filter((u) => u.status === "blocked");
    const safe = priv.updates.filter((u) => u.status === "safe");
    const failed = priv.unparsed.filter((u) => u.level === "failed");

    if (errors.length)
      items.push({
        icon: STATUS_ICON.broken,
        tone: "text-danger",
        text: `${errors.length} ${plural(errors.length, "ошибка", "ошибки", "ошибок")} линтера`,
        to: "/lint",
        cta: "разобрать",
      });
    if (safe.length)
      items.push({
        icon: STATUS_ICON.update_safe,
        tone: "text-accent",
        text: `${safe.length} ${plural(safe.length, "обновление готово", "обновления готовы", "обновлений готовы")} к накату`,
        to: "/updates",
        cta: "обновить",
      });
    if (blocked.length)
      items.push({
        icon: STATUS_ICON.update_blocked,
        tone: "text-warn",
        text: `${blocked.length} ${plural(blocked.length, "обновление держат", "обновления держат", "обновлений держат")} зависимости`,
        to: "/updates",
        cta: "посмотреть",
      });
    if (failed.length)
      items.push({
        icon: STATUS_ICON.unknown,
        tone: "text-faint",
        text: `${failed.length} jar не разобраны`,
        to: "/lint",
        cta: "список",
      });
    if (warnings.length)
      items.push({
        icon: STATUS_ICON.update_blocked,
        tone: "text-warn",
        text: `${warnings.length} ${plural(warnings.length, "предупреждение", "предупреждения", "предупреждений")}`,
        to: "/lint",
        cta: "посмотреть",
      });
    if (priv.platform.length)
      items.push({
        icon: STATUS_ICON.broken,
        tone: "text-danger",
        text: `${priv.platform.length} ${plural(priv.platform.length, "требование к платформе не выполнено", "требования к платформе не выполнены", "требований к платформе не выполнено")}`,
        to: "/lint",
        cta: "посмотреть",
      });
  }

  const linked = new Set<string>();
  for (const edge of data.edges) if (edge.to) linked.add(edge.from).add(edge.to);
  const isolated = isolatedSlugs(data);

  const byStatus = new Map<ModStatus, number>();
  const bySide = new Map<Side, number>();
  for (const mod of data.mods) {
    byStatus.set(mod.status, (byStatus.get(mod.status) ?? 0) + 1);
    bySide.set(mod.side, (bySide.get(mod.side) ?? 0) + 1);
  }

  const statusSegments: Segment[] = (
    ["current", "update_safe", "update_blocked", "broken", "frozen", "unknown"] as ModStatus[]
  ).map((status) => ({
    key: status,
    label: STATUS_LABEL[status],
    value: byStatus.get(status) ?? 0,
    color: STATUS_HEX[status],
    icon: STATUS_ICON[status],
  }));

  const sideSegments: Segment[] = (["both", "client", "server"] as Side[]).map((side) => ({
    key: side,
    label: SIDE_LABEL[side],
    value: bySide.get(side) ?? 0,
    color: SIDE_HEX[side],
    icon: SIDE_ICON[side],
  }));

  // Экономия минимальной сборки относительно полной — единственное число здесь,
  // которое приходится считать, а не читать.
  const saved = data.build_sizes.full - data.build_sizes.minimal;
  const savedPercent = data.build_sizes.full
    ? Math.round((saved / data.build_sizes.full) * 100)
    : 0;

  return (
    <Page>
      <PageTitle icon={LayoutGrid} count={`анализ ${ago(data.generated_at)}`}>
        сводка
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          index={0}
          icon={Boxes}
          value={data.mods.length}
          unit="модов"
          hint={`${data.pack.loader} ${data.pack.loader_version} · ${data.pack.mc}`}
          to="/mods"
        />
        <Stat
          index={1}
          icon={Network}
          value={data.edges.length}
          unit="связей"
          hint={`${linked.size} модов в графе · ${isolated.size} без связей`}
          to="/graph"
        />
        <Stat
          index={2}
          icon={Sparkles}
          value={data.flavor_groups.length}
          unit="групп флейворов"
          hint="переключаемых наборов"
          to="/flavors"
        />
        <Stat
          index={3}
          icon={HardDrive}
          value={bytes(data.build_sizes.full)}
          unit="полная сборка"
          hint={`минимум ${bytes(data.build_sizes.minimal)} · −${savedPercent}%`}
        />
      </div>

      <section>
        <SectionLabel>требует внимания</SectionLabel>
        {!admin ? (
          <Card className="px-5 py-4">
            <p className="text-sm text-muted">
              {workerConfigured() ? (
                <>
                  Состояние пака видно после входа.{" "}
                  <a
                    className="text-accent transition-colors duration-[var(--dur)] hover:text-accent-strong"
                    href={loginUrl()}
                  >
                    войти через GitHub
                  </a>
                </>
              ) : (
                "Публичный режим: доступны состав пака, граф и флейворы."
              )}
            </p>
          </Card>
        ) : privateData.isLoading ? (
          <Loading what="состояние" rows={3} />
        ) : items.length === 0 ? (
          <Card className="flex items-center gap-3 px-5 py-5" glow>
            <CircleCheck aria-hidden size={20} strokeWidth={1.75} className="text-accent" />
            <p className="text-sm text-ink">Всё чисто: обновлений нет, линтер молчит.</p>
          </Card>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {items.map((item, i) => (
              <li key={item.text} style={{ "--stagger-index": i } as React.CSSProperties}>
                <Link to={item.to} className="rise block">
                  <Card interactive className="group flex items-center gap-3.5 px-5 py-4">
                    <span className={`shrink-0 ${item.tone}`}>
                      <item.icon aria-hidden size={18} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-ink">{item.text}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint transition-colors duration-[var(--dur)] group-hover:text-accent">
                      {item.cta}
                      <ArrowRight
                        aria-hidden
                        size={13}
                        strokeWidth={2}
                        className="transition-transform duration-[var(--dur)] group-hover:translate-x-0.5"
                      />
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 px-5 py-5">
          <h2 className="text-sm font-semibold text-ink">Состояние модов</h2>
          <DistBar segments={statusSegments} total={data.mods.length} />
        </Card>
        <Card className="space-y-4 px-5 py-5">
          <h2 className="text-sm font-semibold text-ink">Куда едет мод</h2>
          <DistBar segments={sideSegments} total={data.mods.length} />
        </Card>
      </section>

      {admin && priv && priv.history.length > 0 && (
        <section>
          <SectionLabel>последнее</SectionLabel>
          <Card className="divide-y divide-edge/60 overflow-hidden">
            {priv.history.slice(0, 5).map((entry, i) => (
              <div
                key={entry.sha}
                style={{ "--stagger-index": i } as React.CSSProperties}
                className="rise flex items-baseline gap-3 px-5 py-3 text-sm"
              >
                <span className="shrink-0 rounded-xs bg-raised px-2 py-0.5 font-mono text-2xs text-faint">
                  {entry.op}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    entry.reverted ? "text-faint line-through" : "text-muted"
                  }`}
                >
                  {entry.title}
                </span>
                <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-faint">
                  {stamp(entry.date)}
                </span>
              </div>
            ))}
          </Card>
          <p className="mt-3">
            <Link
              className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors duration-[var(--dur)] hover:text-accent"
              to="/history"
            >
              весь журнал
              <ArrowRight aria-hidden size={12} strokeWidth={2} />
            </Link>
          </p>
        </section>
      )}
    </Page>
  );
}

/** Плитка показателя. Число набрано дисплейным шрифтом и крупно — это то, за
 *  чем на экран и приходят; всё остальное вокруг него подпись. */
function Stat({
  icon: Icon,
  value,
  unit,
  hint,
  to,
  index,
}: {
  icon: LucideIcon;
  value: number | string;
  unit: string;
  hint?: string;
  to?: string;
  index: number;
}) {
  const body = (
    <Card
      interactive={Boolean(to)}
      className="rise group h-full space-y-3 px-5 py-5"
      // Плитки въезжают по очереди слева направо, а не все разом.
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden size={15} strokeWidth={1.75} className="text-faint" />
        <span className="text-2xs text-faint">{unit}</span>
        {to && (
          <ArrowRight
            aria-hidden
            size={13}
            strokeWidth={2}
            className="ml-auto text-faint opacity-0 transition-[opacity,transform] duration-[var(--dur)] group-hover:translate-x-0.5 group-hover:opacity-100"
          />
        )}
      </div>
      <p className="font-display text-2xl leading-none font-semibold tracking-[-0.03em] text-ink">
        {value}
      </p>
      {hint && <p className="font-mono text-2xs text-faint">{hint}</p>}
    </Card>
  );

  return (
    <div style={{ "--stagger-index": index } as React.CSSProperties} className="h-full">
      {to ? (
        <Link to={to} className="block h-full">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
