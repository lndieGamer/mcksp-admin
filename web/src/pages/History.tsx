import { useRunner } from "../components/OpRunner";
import { Button, Empty, Loading, Panel, Tag, stamp } from "../components/ui";
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
    <Panel title={`журнал операций · ${history.length}`}>
      {history.length === 0 ? (
        <Empty>
          пока пусто — журнал строится из коммитов с трейлером <code>Op-Id</code>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="border-b border-edge text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">когда</th>
                <th className="px-2 py-1.5 text-left font-medium">операция</th>
                <th className="px-2 py-1.5 text-left font-medium">что сделано</th>
                <th className="px-2 py-1.5 text-left font-medium">коммит</th>
                <th className="w-px px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.sha} className="border-b border-edge/50">
                  <td className="whitespace-nowrap px-2 py-1.5 text-faint">
                    {stamp(entry.date)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Tag tone={entry.op === "revert" ? "warn" : "neutral"}>{entry.op}</Tag>
                  </td>
                  <td className="px-2 py-1.5 text-muted">
                    {entry.title}
                    {entry.reverted && <span className="ml-2 text-warn">(откачено)</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-faint">
                    <a
                      className="hover:text-accent"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://github.com/lndieGamer/MCKSP-Seventh-Season/commit/${entry.sha}`}
                    >
                      {entry.sha.slice(0, 7)}
                    </a>
                  </td>
                  <td className="px-2 py-1.5">
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
    </Panel>
  );
}
