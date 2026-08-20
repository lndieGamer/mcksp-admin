import { useState } from "react";

import { useRunner } from "../components/OpRunner";
import { Button, Empty, ErrorBox, Input, Panel, Tag, day } from "../components/ui";
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

  if (!session.data) return <Empty>раздел доступен только администратору</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(
          [
            ["modrinth", "Modrinth"],
            ["curseforge", "CurseForge"],
            ["jar", "Локальный jar"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded px-3 py-1.5 text-xs ${
              tab === id ? "bg-raised text-ink" : "text-muted hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "modrinth" && <ModrinthTab />}
      {tab === "curseforge" && <CurseForgeTab />}
      {tab === "jar" && <JarTab />}
    </div>
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
    modrinth<{ hits: MrHit[] }>(`/v2/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=20`)
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
    hit.server_side === "unsupported" ? "client" : hit.client_side === "unsupported" ? "server" : "both";

  return (
    <Panel
      title="поиск по Modrinth"
      actions={
        <>
          <Input
            placeholder="название мода"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-64"
          />
          <Button onClick={search}>искать</Button>
        </>
      }
    >
      {error != null ? <ErrorBox error={error} /> : null}
      {!hits && <Empty>фасеты: project_type:mod, categories:{LOADER}, versions:{MC}</Empty>}

      <div className="grid gap-3 lg:grid-cols-2">
        <ul className="space-y-1">
          {(hits ?? []).map((hit) => (
            <li key={hit.project_id}>
              <button
                onClick={() => open(hit)}
                className="w-full rounded border border-edge px-3 py-2 text-left text-xs hover:border-accent"
              >
                <span className="text-ink">{hit.title}</span>
                {installed.projects.has(hit.project_id) && (
                  <span className="ml-2 text-accent">уже в паке</span>
                )}
                <span className="ml-2 text-faint">{hit.downloads.toLocaleString("ru-RU")} ↓</span>
                <p className="mt-0.5 line-clamp-2 text-faint">{hit.description}</p>
              </button>
            </li>
          ))}
        </ul>

        {versions && (
          <div className="space-y-1">
            <p className="text-xs text-muted">
              версии «{versions.hit.title}» · side по Modrinth: {sideFor(versions.hit)}
            </p>
            {versions.list.slice(0, 15).map((version) => {
              const missing = version.dependencies
                .filter((d) => d.dependency_type === "required" && d.project_id)
                .filter((d) => !installed.projects.has(d.project_id as string));
              return (
                <div
                  key={version.id}
                  className="rounded border border-edge px-3 py-2 text-xs"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-ink">{version.version_number}</span>
                    <span className="text-faint">{day(version.date_published)}</span>
                    <span className="ml-auto">
                      <Button
                        tone="primary"
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
                    </span>
                  </div>
                  <p className="mt-1 text-faint">
                    зависимостей: {version.dependencies.length}
                    {missing.length > 0 && (
                      <span className="ml-2 text-warn">
                        {missing.length} обязательных нет в паке
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
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
    <Panel
      title="поиск по CurseForge"
      actions={
        <>
          <Input
            placeholder="название мода"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-64"
          />
          <Button onClick={search}>искать</Button>
        </>
      }
    >
      {error != null ? <ErrorBox error={error} /> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <ul className="space-y-1">
          {(hits ?? []).map((hit) => (
            <li key={hit.id}>
              <button
                onClick={() => open(hit)}
                className="w-full rounded border border-edge px-3 py-2 text-left text-xs hover:border-accent"
              >
                <span className="text-ink">{hit.name}</span>
                <span className="ml-2 text-faint">
                  {hit.downloadCount.toLocaleString("ru-RU")} ↓
                </span>
                <p className="mt-0.5 line-clamp-2 text-faint">{hit.summary}</p>
              </button>
            </li>
          ))}
        </ul>

        {files && (
          <div className="space-y-1">
            <p className="text-xs text-muted">файлы «{files.hit.name}»</p>
            {files.list.slice(0, 15).map((file) => (
              <div key={file.id} className="flex items-baseline gap-2 rounded border border-edge px-3 py-2 text-xs">
                <span className="truncate font-mono text-ink">{file.displayName}</span>
                <span className="text-faint">{day(file.fileDate)}</span>
                <span className="ml-auto">
                  <Button
                    tone="primary"
                    onClick={() =>
                      runner.propose(
                        { op: "add-curseforge", project_id: files.hit.id, file_id: file.id, side: "both" },
                        <p className="text-muted">
                          Будет добавлен <b>{files.hit.name}</b>, файл {file.fileName}, side{" "}
                          <code>both</code>. Точный дифф покажет коммит.
                        </p>,
                      )
                    }
                  >
                    добавить
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
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
      // One batch request identifies the whole drop; this is identify-jars.ps1,
      // just interactive.
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
    <div className="space-y-3">
      <Panel title="опознание по SHA-1">
        <label
          className="flex cursor-pointer flex-col items-center gap-1 rounded border border-dashed border-edge px-4 py-8 text-xs text-faint hover:border-accent"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          <span>перетащите jar сюда или выберите файлы</span>
          <span className="text-faint">
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
          <ul className="mt-3 space-y-1 text-xs">
            {rows.map((row) => (
              <li key={row.sha1} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-muted">{row.file}</span>
                {row.version ? (
                  <>
                    <Tag tone="accent">опознан на Modrinth</Tag>
                    <span className="font-mono text-faint">{row.version.version_number}</span>
                    {installed.projects.has(row.version.project_id) ? (
                      <Tag>уже в паке</Tag>
                    ) : (
                      <Button
                        tone="primary"
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
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="добавить по прямой ссылке">
        <p className="mb-2 text-2xs text-faint">
          Для неопознанных jar: залейте файл в GitHub Release руками и вставьте прямую ссылку —
          ровно так в паке живут kiriieshki, steampunk-armory и voxy.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="имя мода" value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
          <Input
            placeholder="https://github.com/.../releases/download/.../mod.jar"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-[28rem]"
          />
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as Side)}
            className="rounded border border-edge bg-canvas px-2 py-1.5 text-xs text-ink"
          >
            <option value="both">both</option>
            <option value="client">client</option>
            <option value="server">server</option>
          </select>
          <Button
            tone="primary"
            disabled={!name || !url.startsWith("https://")}
            onClick={() =>
              runner.propose(
                { op: "add-url", name, url, side },
                <p className="text-muted">
                  <code>packwiz url add {name} {url}</code>, затем side <code>{side}</code>. У такого
                  мода не будет блока <code>[update]</code> — обновлять его придётся вручную.
                </p>,
              )
            }
          >
            добавить
          </Button>
        </div>
      </Panel>
    </div>
  );
}
