"""Pack metadata on disk, and the two APIs the jars actually come from.

Reading packwiz metafiles lives here too: a metafile *is* the description of
where a mod comes from, so resolving `mode = "metadata:curseforge"` into a real
download URL belongs next to the CurseForge client.
"""

from __future__ import annotations

import os
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

import httpx

USER_AGENT = "lndieGamer/mcksp-admin/1.0 (github.com/lndieGamer/mcksp-admin)"
MODRINTH_API = "https://api.modrinth.com"
CURSEFORGE_API = "https://api.curseforge.com"
CF_NEOFORGE_LOADER = 6  # modLoaderType in the CurseForge API

# CurseForge requires the API key on CDN downloads too, not just api.curseforge.com.
CF_HOSTS = ("edge.forgecdn.net", "mediafilez.forgecdn.net", "api.curseforge.com")


class CurseForgeAuthError(RuntimeError):
    """Raised for 401/403 from CurseForge, which always means the key, not the file."""


@dataclass
class Metafile:
    """One `mods/<slug>.pw.toml`."""

    slug: str
    path: Path
    name: str
    filename: str
    side: str
    source: str  # modrinth | curseforge | url
    url: str | None = None
    hash: str = ""
    hash_format: str = ""
    project_id: str | None = None
    version_id: str | None = None  # Modrinth version id
    file_id: int | None = None  # CurseForge file id

    @property
    def cache_key(self) -> str:
        algo = self.hash_format or "nohash"
        return f"{algo}-{self.hash}" if self.hash else f"{algo}-{self.slug}"

    @property
    def has_update_source(self) -> bool:
        return self.source in ("modrinth", "curseforge")


@dataclass
class Pack:
    root: Path
    name: str
    version: str
    minecraft: str
    loader: str
    loader_version: str
    metafiles: list[Metafile] = field(default_factory=list)


def load_pack(root: Path) -> Pack:
    data = tomllib.loads((root / "pack.toml").read_text("utf-8"))
    versions = data.get("versions", {})
    loader = next((k for k in ("neoforge", "forge", "fabric", "quilt") if k in versions), "neoforge")
    pack = Pack(
        root=root,
        name=data.get("name", ""),
        version=str(data.get("version", "0.0.0")),
        minecraft=str(versions.get("minecraft", "")),
        loader=loader,
        loader_version=str(versions.get(loader, "")),
    )
    pack.metafiles = load_metafiles(root / "mods")
    return pack


def load_metafiles(mods_dir: Path) -> list[Metafile]:
    out = []
    for path in sorted(mods_dir.glob("*.pw.toml")):
        out.append(_parse_metafile(path))
    return out


def _parse_metafile(path: Path) -> Metafile:
    data = tomllib.loads(path.read_text("utf-8"))
    download = data.get("download", {}) or {}
    update = data.get("update", {}) or {}
    mr, cf = update.get("modrinth") or {}, update.get("curseforge") or {}

    if mr:
        source, project_id = "modrinth", str(mr.get("mod-id") or "")
    elif cf or download.get("mode") == "metadata:curseforge":
        source, project_id = "curseforge", str(cf.get("project-id") or "")
    else:
        source, project_id = "url", None

    return Metafile(
        slug=path.name.removesuffix(".pw.toml"),
        path=path,
        name=str(data.get("name", "")),
        filename=str(data.get("filename", "")),
        side=str(data.get("side", "both")),
        source=source,
        url=download.get("url"),
        hash=str(download.get("hash", "")),
        hash_format=str(download.get("hash-format", "")),
        project_id=project_id or None,
        version_id=str(mr["version"]) if mr.get("version") else None,
        file_id=int(cf["file-id"]) if cf.get("file-id") else None,
    )


def load_unsup(path: Path) -> dict:
    """Read `unsup.toml`; it sits next to pack.toml but outside the packwiz index."""
    if not path.exists():
        return {}
    return tomllib.loads(path.read_text("utf-8"))


class Client:
    """One HTTP client for Modrinth, CurseForge and the CDNs behind them."""

    def __init__(self, cf_api_key: str | None = None, timeout: float = 60.0):
        self.cf_api_key = cf_api_key or os.environ.get("CF_API_KEY") or ""
        self._http = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- transport ---------------------------------------------------------

    def _headers_for(self, url: str) -> dict[str, str]:
        if any(h in url for h in CF_HOSTS):
            return {"x-api-key": self.cf_api_key}
        return {}

    def get(self, url: str, *, params: dict | None = None, retries: int = 3) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(retries):
            try:
                r = self._http.get(url, params=params, headers=self._headers_for(url))
            except httpx.HTTPError as exc:
                last = exc
                time.sleep(2**attempt)
                continue
            if r.status_code in (401, 403) and any(h in url for h in CF_HOSTS):
                raise CurseForgeAuthError(
                    f"CurseForge rejected the request ({r.status_code}) for {url}. "
                    "Since 2026-07-16 the CDN needs a valid CF_API_KEY; check the secret."
                )
            if r.status_code == 429 or r.status_code >= 500:
                last = httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
                time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
                continue
            return r
        raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")

    def get_json(self, url: str, *, params: dict | None = None) -> dict | list | None:
        r = self.get(url, params=params)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    # -- downloads ---------------------------------------------------------

    def download_url_for(self, mf: Metafile) -> str | None:
        """Direct URL, or the one CurseForge only hands out over the API."""
        if mf.url:
            return mf.url
        if mf.source == "curseforge" and mf.project_id and mf.file_id:
            data = self.get_json(f"{CURSEFORGE_API}/v1/mods/{mf.project_id}/files/{mf.file_id}")
            if isinstance(data, dict):
                file = data.get("data") or {}
                if file.get("downloadUrl"):
                    return file["downloadUrl"]
                # downloadUrl is null when the author opted out of third-party
                # downloads; the deterministic CDN path still serves the file.
                return cf_cdn_url(mf.file_id, file.get("fileName") or mf.filename)
            return cf_cdn_url(mf.file_id, mf.filename)
        return None

    def fetch_jar(self, mf: Metafile) -> bytes:
        url = self.download_url_for(mf)
        if not url:
            raise RuntimeError(f"{mf.slug}: no download URL (source={mf.source})")
        r = self.get(url)
        r.raise_for_status()
        return r.content

    # -- Modrinth ----------------------------------------------------------

    def modrinth_project(self, project_id: str) -> dict | None:
        data = self.get_json(f"{MODRINTH_API}/v2/project/{project_id}")
        return data if isinstance(data, dict) else None

    def modrinth_projects(self, ids: list[str]) -> dict[str, dict]:
        """Batch project lookup; used for the client_side/server_side lint."""
        out: dict[str, dict] = {}
        for chunk in (ids[i : i + 100] for i in range(0, len(ids), 100)):
            payload = "[" + ",".join(f'"{i}"' for i in chunk) + "]"
            data = self.get_json(f"{MODRINTH_API}/v2/projects", params={"ids": payload})
            for project in data if isinstance(data, list) else []:
                out[project["id"]] = project
                if project.get("slug"):
                    out[project["slug"]] = project
        return out

    def modrinth_versions(self, project_id: str, mc: str, loader: str) -> list[dict]:
        data = self.get_json(
            f"{MODRINTH_API}/v2/project/{project_id}/version",
            params={"loaders": f'["{loader}"]', "game_versions": f'["{mc}"]'},
        )
        return data if isinstance(data, list) else []

    def modrinth_latest(self, project_id: str, mc: str, loader: str) -> dict | None:
        versions = self.modrinth_versions(project_id, mc, loader)
        if not versions:
            return None
        return max(versions, key=lambda v: v.get("date_published", ""))

    # -- CurseForge --------------------------------------------------------

    def curseforge_files(self, project_id: str, mc: str) -> list[dict]:
        data = self.get_json(
            f"{CURSEFORGE_API}/v1/mods/{project_id}/files",
            params={"gameVersion": mc, "modLoaderType": CF_NEOFORGE_LOADER, "pageSize": 50},
        )
        return (data or {}).get("data", []) if isinstance(data, dict) else []

    def curseforge_latest(self, project_id: str, mc: str) -> dict | None:
        files = self.curseforge_files(project_id, mc)
        if not files:
            return None
        return max(files, key=lambda f: f.get("fileDate", ""))


def cf_cdn_url(file_id: int, filename: str) -> str:
    return f"https://edge.forgecdn.net/files/{file_id // 1000}/{file_id % 1000}/{filename}"
