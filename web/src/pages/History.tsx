import { Lock, RotateCcw, ScrollText, SquareArrowOutUpRight } from "lucide-react";

import { useRunner } from "../components/OpRunner";
import { Button, Empty, Loading, Page, PageTitle, Tag, Th, stamp } from "../components/ui";
import { usePrivate, useSession } from "../lib/data";

export default function History() {
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();

  if (!session.data) return <Empty icon={Lock}>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="журнал операций" />;
  if (!privateData.data) return <Empty icon={ScrollText}>private.json недоступен</Empty>;

  const { history } = privateData.data;

  return (
    <Page scroll={false}>
      <PageTitle icon={ScrollText} count={history.length}>
        журнал операций
      </PageTitle>

      {history.length === 0 ? (
        <Empty icon={ScrollText}>
          пока пусто — журнал строится из коммитов с трейлером <code>Op-Id</code>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-edge-strong [&>th]:bg-canvas/95 [&>th]:pt-2 [&>th]:backdrop-blur">
                <Th className="w-[190px]">когда</Th>
                <Th className="w-[124px]">операция</Th>
                <Th>что сделано</Th>
                <Th className="w-[104px]">коммит</Th>
                <Th className="w-[136px]" />
              </tr>
            </thead>
            <tbody>
              {history.map((entry, i) => (
                <tr
                  key={entry.sha}
                  style={{ "--stagger-index": Math.min(i, 18) } as React.CSSProperties}
                  className="rise h-12 transition-colors duration-[var(--dur-fast)] hover:bg-raised/45 [&>td]:rule"
                >
                  <td className="px-3 font-mono text-xs whitespace-nowrap text-faint">
                    {stamp(entry.date)}
                  </td>
                  <td className="px-3">
                    <Tag tone={entry.op === "revert" ? "warn" : "neutral"}>{entry.op}</Tag>
                  </td>
                  <td className="px-3 text-xs text-ink">
                    <span className={entry.reverted ? "text-faint line-through" : undefined}>
                      {entry.title}
                    </span>
                    {entry.reverted && <span className="ml-2 text-2xs text-warn">откачено</span>}
                  </td>
                  <td className="px-3 font-mono text-xs">
                    <a
                      className="inline-flex items-center gap-1.5 text-faint transition-colors duration-[var(--dur-fast)] hover:text-accent"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://github.com/lndieGamer/MCKSP-Seventh-Season/commit/${entry.sha}`}
                    >
                      {entry.sha.slice(0, 7)}
                      <SquareArrowOutUpRight aria-hidden size={11} strokeWidth={2} />
                    </a>
                  </td>
                  <td className="px-3 text-right">
                    <Button
                      icon={RotateCcw}
                      disabled={entry.reverted}
                      onClick={() =>
                        runner.propose(
                          { op: "revert", sha: entry.sha },
                          <p className="text-muted">
                            <code>git revert</code> коммита {entry.sha.slice(0, 7)} («{entry.title}
                            »), затем <code>packwiz refresh</code>. Откат идёт через ту же очередь,
                            что и остальные операции.
                          </p>,
                        )
                      }
                    >
                      откатить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
