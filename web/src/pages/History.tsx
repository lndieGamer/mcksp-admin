import { useRunner } from "../components/OpRunner";
import { Button, Empty, Loading, Page, PageTitle, Tag, Th, stamp } from "../components/ui";
import { usePrivate, useSession } from "../lib/data";

export default function History() {
  const privateData = usePrivate();
  const session = useSession();
  const runner = useRunner();

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;
  if (privateData.isLoading) return <Loading what="журнал операций" />;
  if (!privateData.data) return <Empty>private.json недоступен</Empty>;

  const { history } = privateData.data;

  return (
    <Page scroll={false}>
      <PageTitle count={history.length}>журнал операций</PageTitle>

      {history.length === 0 ? (
        <Empty>
          пока пусто — журнал строится из коммитов с трейлером <code>Op-Id</code>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[840px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-edge-strong [&>th]:bg-canvas [&>th]:pt-1">
                <Th className="w-[168px]">когда</Th>
                <Th className="w-[104px]">операция</Th>
                <Th>что сделано</Th>
                <Th className="w-[88px]">коммит</Th>
                <Th className="w-[110px]" />
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.sha} className="h-9 hover:bg-raised/45 [&>td]:rule">
                  <td className="px-2 font-mono text-xs whitespace-nowrap text-faint">
                    {stamp(entry.date)}
                  </td>
                  <td className="px-2">
                    <Tag tone={entry.op === "revert" ? "warn" : "neutral"}>{entry.op}</Tag>
                  </td>
                  <td className="px-2 text-ink">
                    <span className={entry.reverted ? "text-faint line-through" : undefined}>
                      {entry.title}
                    </span>
                    {entry.reverted && <span className="ml-2 text-xs text-warn">откачено</span>}
                  </td>
                  <td className="px-2 font-mono text-xs">
                    <a
                      className="text-faint underline decoration-transparent underline-offset-2 transition-colors duration-[--dur-fast] hover:text-accent hover:decoration-accent-dim"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://github.com/lndieGamer/MCKSP-Seventh-Season/commit/${entry.sha}`}
                    >
                      {entry.sha.slice(0, 7)}
                    </a>
                  </td>
                  <td className="px-2 text-right">
                    <Button
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
