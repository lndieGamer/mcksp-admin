import { Download, FileArchive, Link2, Lock, Plus, Search, Upload } from "lucide-react";
import { useState } from "react";

import { useRunner } from "../components/OpRunner";
import {
  Band,
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  ModIcon,
  Page,
  PageTitle,
  Segmented,
  Select,
  Tag,
  day,
} from "../components/ui";
import { api, curseforge, modrinth } from "../lib/api";
import { usePublic, useSession } from "../lib/data";
import type { Side } from "../lib/types";

type Tab = "modrinth" | "curseforge" | "jar";

const MC = "1.21.1";
const LOADER = "neoforge";
const CF_NEOFORGE = 6;

interface MrHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  client_side: string;
  server_side: string;
}

interface MrVersion {
  id: string;
  name: string;
  version_number: string;
  date_published: string;
  dependencies: { project_id: string | null; dependency_type: string }[];
  files: { primary: boolean; url: string; filename: string }[];
}

interface CfHit {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
}

interface CfFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
}

export default function Import() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("modrinth");

  if (!session.data) return <Empty icon={Lock}>раздел доступен только администратору</Empty>;

  return (
    <Page>
      <PageTitle
        icon={Upload}
        actions={
          <Segmented<Tab>
            label="откуда добавляем"
            value={tab}
            onChange={setTab}
            options={[
              { value: "modrinth", label: "Modrinth", icon: Search },
              { value: "curseforge", label: "CurseForge", icon: Search },
              { value: "jar", label: "Локальный jar", icon: FileArchive },
            ]}
          />
        }
      >
        импорт
      </PageTitle>
      {tab === "modrinth" && <ModrinthTab />}
      {tab === "curseforge" && <CurseForgeTab />}
      {tab === "jar" && <JarTab />}
    </Page>
  );
}

function useInstalled() {
  const publicData = usePublic();
  return {
    slugs: new Set((publicData.data?.mods ?? []).map((m) => m.slug)),
    projects: new Set(
      (publicData.data?.mods ?? []).map((m) => m.project_id).filter(Boolean) as string[],
    ),
  };
}

/** Карточка результата поиска. Одна на оба каталога: различаются только
 *  источник иконки и подпись счётчика загрузок. */
function Hit({
  title,
  description,
  downloads,
  projectId,
  slug,
  installed,
  active,
  onClick,
  index,
}: {
  title: string;
  description: string;
  downloads: number;
  projectId?: string;
  slug: string;
  installed: boolean;
  active: boolean;
  onClick: () => void;
  index: number;
}) {
  return (
    <li style={{ "--stagger-index": Math.min(index, 12) } as React.CSSProperties}>
      <button onClick={onClick} className="rise block w-full text-left">
        <Card
          interactive
          className={`flex items-start gap-3 px-4 py-3 ${active ? "border-accent-dim" : ""}`}
        >
          <ModIcon slug={slug} projectId={projectId} source="modrinth" size={34} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2">
              <span className="min-w-0 truncate text-xs text-ink">{title}</span>
              {installed && <Tag tone="accent">уже в паке</Tag>}
              <span className="ml-auto shrink-0 font-mono text-2xs text-faint">
                {downloads.toLocaleString("ru-RU")} ↓
              </span>
            </p>
            <p className="mt-1 line-clamp-2 text-2xs text-faint">{description}</p>
          </div>
        </Card>
      </button>
    </li>
  );
}

function ModrinthTab() {
  const runner = useRunner();
  const installed = useInstalled();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MrHit[] | null>(null);
  const [versions, setVersions] = useState<{ hit: MrHit; list: MrVersion[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const facets = encodeURIComponent(
    JSON.stringify([["project_type:mod"], [`categories:${LOADER}`], [`versions:${MC}`]]),
  );

  const search = () => {
    setError(null);
    setVersions(null);
    modrinth<{ hits: MrHit[] }>(
      `/v2/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=20`,
    )
      .then((data) => setHits(data.hits))
      .catch(setError);
  };

  const open = (hit: MrHit) => {
    setError(null);
    modrinth<MrVersion[]>(
      `/v2/project/${hit.slug}/version?loaders=%5B%22${LOADER}%22%5D&game_versions=%5B%22${MC}%22%5D`,
    )
      .then((list) => setVersions({ hit, list }))
      .catch(setError);
  };

  const sideFor = (hit: MrHit): Side =>
    hit.server_side === "unsupported"
      ? "client"
      : hit.client_side === "unsupported"
        ? "server"
        : "both";

  return (
    <Band
      title="поиск по Modrinth"
      actions={
        <>
          <Input
            placeholder="название мода"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-72"
          />
          <Button icon={Search} onClick={search}>
            искать
          </Button>
        </>
      }
    >
      {error != null ? <ErrorBox error={error} /> : null}
      {!hits && (
        <p className="max-w-[74ch] text-xs text-faint">
          Введите название и нажмите «искать». Ищутся только моды под{" "}
          <span className="font-mono">
            {LOADER} {MC}
          </span>
          , остальное Modrinth не вернёт.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ul className="space-y-2">
          {(hits ?? []).map((hit, i) => (
            <Hit
              key={hit.project_id}
              index={i}
              title={hit.title}
              description={hit.description}
              downloads={hit.downloads}
              projectId={hit.project_id}
              slug={hit.slug}
              installed={installed.projects.has(hit.project_id)}
              active={versions?.hit.project_id === hit.project_id}
              onClick={() => open(hit)}
            />
          ))}
        </ul>

        {versions && (
          <div className="fade-in space-y-2">
            <p className="text-xs text-muted">
              версии «{versions.hit.title}» · side по Modrinth:{" "}
              <span className="font-mono">{sideFor(versions.hit)}</span>
            </p>
            {versions.list.slice(0, 15).map((version) => {
              const missing = version.dependencies
                .filter((d) => d.dependency_type === "required" && d.project_id)
                .filter((d) => !installed.projects.has(d.project_id as string));
              return (
                <Card key={version.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs text-ink">{version.version_number}</span>
                    <span className="font-mono text-2xs text-faint">
                      {day(version.date_published)}
                    </span>
                    <Button
                      className="ml-auto"
                      tone="primary"
                      icon={Plus}
                      onClick={() =>
                        runner.propose(
                          {
                            op: "add-modrinth",
                            version_id: version.id,
                            slug: versions.hit.slug,
                            side: sideFor(versions.hit),
                          },
                          <p className="text-muted">
                            Будет добавлен <b>{versions.hit.title}</b> версии{" "}
                            {version.version_number}, side <code>{sideFor(versions.hit)}</code>,
                            метафайл <code>mods/{versions.hit.slug}.pw.toml</code>. Точный дифф
                            покажет коммит.
                          </p>,
                        )
                      }
                    >
                      добавить
                    </Button>
                  </div>
                  <p className="text-2xs text-faint">
                    зависимостей: {version.dependencies.length}
                    {missing.length > 0 && (
                      <span className="ml-2 text-warn">{missing.length} обязательных нет в паке</span>
                    )}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Band>
  );
}

function CurseForgeTab() {
  const runner = useRunner();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CfHit[] | null>(null);
  const [files, setFiles] = useState<{ hit: CfHit; list: CfFile[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const search = () => {
    setError(null);
    setFiles(null);
    curseforge<{ data: CfHit[] }>(
      `/v1/mods/search?gameId=432&gameVersion=${MC}&modLoaderType=${CF_NEOFORGE}&searchFilter=${encodeURIComponent(query)}&pageSize=20`,
    )
      .then((data) => setHits(data.data))
      .catch(setError);
  };

  const open = (hit: CfHit) => {
    setError(null);
    curseforge<{ data: CfFile[] }>(
      `/v1/mods/${hit.id}/files?gameVersion=${MC}&modLoaderType=${CF_NEOFORGE}&pageSize=20`,
    )
      .then((data) => setFiles({ hit, list: data.data }))
      .catch(setError);
  };

  return (
    <Band
      title="поиск по CurseForge"
      actions={
        <>
          <Input
            placeholder="название мода"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-72"
          />
          <Button icon={Search} onClick={search}>
            искать
          </Button>
        </>
      }
    >
      {error != null ? <ErrorBox error={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ul className="space-y-2">
          {(hits ?? []).map((hit, i) => (
            <Hit
              key={hit.id}
              index={i}
              title={hit.name}
              description={hit.summary}
              downloads={hit.downloadCount}
              slug={String(hit.name)}
              installed={false}
              active={files?.hit.id === hit.id}
              onClick={() => open(hit)}
            />
          ))}
        </ul>

        {files && (
          <div className="fade-in space-y-2">
            <p className="text-xs text-muted">файлы «{files.hit.name}»</p>
            {files.list.slice(0, 15).map((file) => (
              <Card key={file.id} className="flex items-center gap-2.5 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {file.displayName}
                </span>
                <span className="shrink-0 font-mono text-2xs text-faint">{day(file.fileDate)}</span>
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() =>
                    runner.propose(
                      {
                        op: "add-curseforge",
                        project_id: files.hit.id,
                        file_id: file.id,
                        side: "both",
                      },
                      <p className="text-muted">
                        Будет добавлен <b>{files.hit.name}</b>, файл {file.fileName}, side{" "}
                        <code>both</code>. Точный дифф покажет коммит.
                      </p>,
                    )
                  }
                >
                  добавить
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Band>
  );
}

interface Identified {
  file: string;
  sha1: string;
  version?: MrVersion & { project_id: string };
}

function JarTab() {
  const runner = useRunner();
  const installed = useInstalled();
  const [rows, setRows] = useState<Identified[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [side, setSide] = useState<Side>("both");

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const hashed: Identified[] = [];
      for (const file of Array.from(files)) {
        const digest = await crypto.subtle.digest("SHA-1", await file.arrayBuffer());
        const sha1 = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        hashed.push({ file: file.name, sha1 });
      }
      // Один батч-запрос опознаёт всю пачку — это identify-jars.ps1, только
      // интерактивный.
      const map = await api<Record<string, MrVersion & { project_id: string }>>(
        "/api/mr/v2/version_files",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hashes: hashed.map((h) => h.sha1), algorithm: "sha1" }),
        },
      );
      setRows(hashed.map((h) => ({ ...h, version: map[h.sha1] })));
    } catch (exc) {
      setError(exc);
    }
  };

  return (
    <div className="space-y-8">
      <Band title="опознание по SHA-1">
        <label
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-center text-xs transition-[border-color,background-color,transform] duration-[var(--dur)] ease-quint ${
            dragging
              ? "scale-[1.01] border-accent bg-accent/5 text-ink"
              : "border-edge text-faint hover:border-accent-dim hover:bg-raised/20 hover:text-muted"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onFiles(e.dataTransfer.files);
          }}
        >
          <FileArchive aria-hidden size={26} strokeWidth={1.5} className="text-faint" />
          <span className="text-sm">перетащите jar сюда или выберите файлы</span>
          <span className="text-2xs text-faint">
            хеш считается в браузере через crypto.subtle, сам файл никуда не уходит
          </span>
          <input
            type="file"
            multiple
            accept=".jar"
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        {error != null ? <ErrorBox error={error} /> : null}
        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.sha1} style={{ "--stagger-index": i } as React.CSSProperties}>
                <Card className="rise flex flex-wrap items-center gap-2.5 px-4 py-3">
                  <FileArchive aria-hidden size={15} strokeWidth={1.75} className="text-faint" />
                  <span className="font-mono text-xs text-muted">{row.file}</span>
                  {row.version ? (
                    <>
                      <Tag tone="accent">опознан на Modrinth</Tag>
                      <span className="font-mono text-2xs text-faint">
                        {row.version.version_number}
                      </span>
                      {installed.projects.has(row.version.project_id) ? (
                        <Tag>уже в паке</Tag>
                      ) : (
                        <Button
                          className="ml-auto"
                          tone="primary"
                          icon={Download}
                          onClick={() =>
                            runner.propose(
                              { op: "add-modrinth", version_id: row.version!.id },
                              <p className="text-muted">
                                Будет добавлен мод из {row.file} (версия{" "}
                                {row.version!.version_number}); side определится по Modrinth.
                              </p>,
                            )
                          }
                        >
                          добавить
                        </Button>
                      )}
                    </>
                  ) : (
                    <Tag tone="warn">не опознан — нужна прямая ссылка</Tag>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Band>

      <Band title="добавить по прямой ссылке">
        <Card className="space-y-4 px-5 py-5">
          <p className="max-w-[74ch] text-xs text-faint">
            Для неопознанных jar: залейте файл в GitHub Release руками и вставьте прямую ссылку —
            ровно так в паке живут kiriieshki, steampunk-armory и voxy.
          </p>
          <div className="flex flex-wrap items-end gap-2.5">
            <Input
              placeholder="имя мода"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-52"
            />
            <Input
              placeholder="https://github.com/.../releases/download/.../mod.jar"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-[30rem]"
            />
            <Select value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="both">both</option>
              <option value="client">client</option>
              <option value="server">server</option>
            </Select>
            <Button
              tone="primary"
              icon={Link2}
              disabled={!name || !url.startsWith("https://")}
              onClick={() =>
                runner.propose(
                  { op: "add-url", name, url, side },
                  <p className="text-muted">
                    <code>
                      packwiz url add {name} {url}
                    </code>
                    , затем side <code>{side}</code>. У такого мода не будет блока{" "}
                    <code>[update]</code> — обновлять его придётся вручную.
                  </p>,
                )
              }
            >
              добавить
            </Button>
          </div>
        </Card>
      </Band>
    </div>
  );
}
