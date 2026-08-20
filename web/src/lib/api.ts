import type { PrivateData, PublicData, Session } from "./types";

const WORKER = (import.meta.env.VITE_WORKER_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "mcksp-admin-session";

/**
 * sessionStorage, not localStorage: the session dies with the tab. The GitHub
 * token never reaches the browser at all, so this token is only useful to
 * whoever is already sitting in front of the open tab.
 */
export function readSession(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** The Worker redirects back with `#session=<token>`; take it and clean the URL. */
export function captureSessionFromHash(): void {
  const match = /[#&]session=([^&]+)/.exec(window.location.hash);
  if (!match) return;
  sessionStorage.setItem(SESSION_KEY, decodeURIComponent(match[1]));
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function loginUrl(): string {
  return `${WORKER}/auth/login`;
}

export function workerConfigured(): boolean {
  return WORKER.length > 0;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readSession();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${WORKER}${path}`, { ...init, headers });
  if (response.status === 401) {
    clearSession();
    throw new ApiError("session expired", 401);
  }
  if (!response.ok) {
    throw new ApiError(`${init.method ?? "GET"} ${path}: ${response.status}`, response.status);
  }
  return response;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

/**
 * Public mode reads the static file straight off Pages -- no session, and no
 * request to /api/* at all. That is what makes the link safe to hand to players.
 */
export async function fetchPublic(): Promise<PublicData> {
  const response = await fetch(`${import.meta.env.BASE_URL}public.json`, { cache: "no-cache" });
  if (!response.ok) throw new ApiError("public.json is not published yet", response.status);
  return response.json();
}

export async function fetchPrivate(): Promise<PrivateData> {
  return api<PrivateData>("/data/private.json");
}

export async function fetchMe(): Promise<Session> {
  return api<Session>("/auth/me");
}

export async function logout(): Promise<void> {
  try {
    await request("/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
}

// -- upstream APIs, all through the Worker ---------------------------------

export function modrinth<T>(path: string): Promise<T> {
  return api<T>(`/api/mr${path}`);
}

export function curseforge<T>(path: string): Promise<T> {
  return api<T>(`/api/cf${path}`);
}

export function github<T>(path: string, init?: RequestInit): Promise<T> {
  return api<T>(`/api/gh${path}`, init);
}

export async function githubVoid(path: string, init: RequestInit): Promise<void> {
  await request(`/api/gh${path}`, init);
}
