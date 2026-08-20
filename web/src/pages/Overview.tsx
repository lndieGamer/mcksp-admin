import { Link } from "react-router-dom";

import {
  Loading,
  Page,
  PageTitle,
  SectionLabel,
  ago,
  bytes,
  plural,
  stamp,
} from "../components/ui";
import { loginUrl, workerConfigured } from "../lib/api";
import { usePrivate, usePublic, useSession } from "../lib/data";

interface Item {
  glyph: string;
  tone: string;
  text: string;
  to: string;
  cta: string;
}

/** The question this screen answers is "is anything wrong", so it is a queue of
 *  decisions, not a wall of metrics. Nothing to decide is itself an answer. */
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
        glyph: "✕",
        tone: "text-danger",
        text: `${errors.length} ${plural(errors.length, "ошибка", "ошибки", "ошибок")} линтера`,
        to: "/lint",
        cta: "разобрать",
      });
    if (safe.length)
      items.push({
        glyph: "▲",
        tone: "text-accent",
        text: `${safe.length} ${plural(safe.length, "обновление готово", "обновления готовы", "обновлений готовы")} к накату`,
        to: "/updates",
        cta: "обновить",
      });
    if (blocked.length)
      items.push({
        glyph: "⊘",
        tone: "text-warn",
        text: `${blocked.length} ${plural(blocked.length, "обновление держат", "обновления держат", "обновлений держат")} зависимости`,
        to: "/updates",
        cta: "посмотреть",
      });
    if (failed.length)
      items.push({
        glyph: "◻",
        tone: "text-faint",
        text: `${failed.length} jar не разобраны`,
        to: "/lint",
        cta: "список",
      });
    if (warnings.length)
      items.push({
        glyph: "■",
        tone: "text-warn",
        text: `${warnings.length} ${plural(warnings.length, "предупреждение", "предупреждения", "предупреждений")}`,
        to: "/lint",
        cta: "посмотреть",
      });
    if (priv.platform.length)
      items.push({
        glyph: "⊘",
        tone: "text-danger",
        text: `${priv.platform.length} ${plural(priv.platform.length, "требование к платформе не выполнено", "требования к платформе не выполнены", "требований к платформе не выполнено")}`,
        to: "/lint",
        cta: "посмотреть",
      });
  }

  const linked = new Set<string>();
  for (const edge of data.edges) if (edge.to) linked.add(edge.from).add(edge.to);

  return (
    <Page>
      <div className="w-full max-w-[900px] space-y-8">
        <PageTitle count={`анализ ${ago(data.generated_at)}`}>сводка</PageTitle>
      <section>
        <SectionLabel>требует внимания</SectionLabel>
        {!admin ? (
          <p className="text-sm text-muted">
            {workerConfigured() ? (
              <>
                Состояние пака видно после входа.{" "}
                <a className="text-accent hover:text-accent-strong" href={loginUrl()}>
                  войти через GitHub
                </a>
              </>
            ) : (
              "Публичный режим: доступны состав пака, граф и флейворы."
            )}
          </p>
        ) : privateData.isLoading ? (
          <Loading what="состояние" rows={3} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            <span aria-hidden className="mr-2 text-accent">
              ●
            </span>
            Всё чисто: обновлений нет, линтер молчит.
          </p>
        ) : (
          <ul className="divide-y divide-edge border-y border-edge">
            {items.map((item) => (
              <li key={item.text}>
                <Link
                  to={item.to}
                  className="group flex items-center gap-3 py-2.5 transition-colors duration-[--dur-fast] hover:bg-raised/40"
                >
                  <span aria-hidden className={`w-4 text-center text-sm ${item.tone}`}>
                    {item.glyph}
                  </span>
                  <span className="text-base text-ink">{item.text}</span>
                  <span className="ml-auto pr-2 text-sm text-faint transition-colors duration-[--dur-fast] group-hover:text-accent">
                    {item.cta} <span aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionLabel>пак сейчас</SectionLabel>
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted">
          <Fact value={data.mods.length} unit="модов" />
          <Fact value={data.edges.length} unit="связей" hint={`${linked.size} модов в графе`} />
          <Fact value={data.flavor_groups.length} unit="групп флейворов" />
          <div>
            <dt className="sr-only">вес полной сборки</dt>
            <dd className="font-mono text-ink">{bytes(data.build_sizes.full)}</dd>
            <span className="text-xs text-faint">минимум {bytes(data.build_sizes.minimal)}</span>
          </div>
        </dl>
      </section>

      {admin && priv && priv.history.length > 0 && (
        <section>
          <SectionLabel>последнее</SectionLabel>
          <ul className="divide-y divide-edge border-y border-edge">
            {priv.history.slice(0, 5).map((entry) => (
              <li key={entry.sha} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-faint">{entry.op}</span>
                <span className={entry.reverted ? "text-faint line-through" : "text-muted"}>
                  {entry.title}
                </span>
                <span className="ml-auto font-mono text-xs whitespace-nowrap text-faint">
                  {stamp(entry.date)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">
            <Link
              className="underline decoration-edge-strong underline-offset-2 transition-colors duration-[--dur-fast] hover:text-accent"
              to="/history"
            >
              весь журнал
            </Link>
          </p>
        </section>
      )}
      </div>
    </Page>
  );
}

function Fact({ value, unit, hint }: { value: number; unit: string; hint?: string }) {
  return (
    <div>
      <dt className="sr-only">{unit}</dt>
      <dd className="font-mono text-ink">
        {value} <span className="font-sans text-muted">{unit}</span>
      </dd>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}
