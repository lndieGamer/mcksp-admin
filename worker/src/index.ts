/**
 * The only backend: GitHub OAuth, session issuing, and a narrow proxy to the
 * three APIs the panel needs.
 *
 * Sessions travel in `Authorization: Bearer <session>`, never in a cookie.
 * Pages lives on lndiegamer.github.io and this Worker on workers.dev, so any
 * cookie would be third-party: SameSite=Lax would not send it on fetch, and
 * SameSite=None is blocked outright by Safari and Brave. The value we actually
 * care about survives anyway -- the GitHub token never reaches the browser, and
 * the session token is useless without this Worker.
 */

export interface Env {
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  GH_DISPATCH_TOKEN: string;
  CF_API_KEY: string;
  SESSION_SECRET: string;
  ALLOWED_LOGIN: string; // one login, or several separated by commas
  STATE: KVNamespace;
  PAGES_URL?: string;
  DEV_ORIGIN?: string;
}

const DEFAULT_PAGES_URL = "https://lndiegamer.github.io/mcksp-admin/";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 600;
const USER_AGENT = "lndieGamer/mcksp-admin/1.0 (github.com/lndieGamer/mcksp-admin)";

const ADMIN_REPO = "lndieGamer/mcksp-admin";
const PACK_REPO = "lndieGamer/MCKSP-Seventh-Season";

/**
 * The GitHub proxy is not a general tunnel. Only these method/path pairs pass;
 * everything else is 403 even with a valid session.
 */
const GH_ALLOWLIST: ReadonlyArray<[string, RegExp]> = [
  ["GET", /^\/repos\/lndieGamer\/(MCKSP-Seventh-Season|mcksp-admin)\/contents\//],
  ["GET", /^\/repos\/lndieGamer\/mcksp-admin\/actions\/runs(\?|$)/],
  ["GET", /^\/repos\/lndieGamer\/mcksp-admin\/actions\/runs\/\d+(\/jobs)?(\?|$)/],
  ["POST", /^\/repos\/lndieGamer\/mcksp-admin\/actions\/workflows\/mutate\.yml\/dispatches$/],
  // /settings has a "re-run the analysis" button; it writes nothing to the pack.
  ["POST", /^\/repos\/lndieGamer\/mcksp-admin\/actions\/workflows\/analyze\.yml\/dispatches$/],
  ["GET", /^\/repos\/lndieGamer\/MCKSP-Seventh-Season\/commits(\?|\/|$)/],
];

// -- encoding helpers -------------------------------------------------------

const encoder = new TextEncoder();

function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// -- sessions ---------------------------------------------------------------

export interface SessionPayload {
  login: string;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueSession(login: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { login, iat: now, exp: now + SESSION_TTL_SECONDS };
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64urlEncode(signature)}`;
}

export async function verifySession(
  token: string | null,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  let valid: boolean;
  try {
    // crypto.subtle.verify is constant-time; never compare the strings by hand.
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      base64urlDecode(signature),
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  } catch {
    return null;
  }
  // A forged exp cannot survive the signature check, but an honestly expired
  // one can, so it is checked separately on every request.
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function allowedLogins(env: Env): string[] {
  return (env.ALLOWED_LOGIN ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// -- CORS -------------------------------------------------------------------

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = [new URL(env.PAGES_URL ?? DEFAULT_PAGES_URL).origin];
  if (env.DEV_ORIGIN) allowed.push(env.DEV_ORIGIN);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

// -- proxying ---------------------------------------------------------------

const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
]);

async function proxy(
  request: Request,
  target: string,
  extraHeaders: Record<string, string>,
  cors: Record<string, string>,
): Promise<Response> {
  const headers = new Headers(extraHeaders);
  headers.set("User-Agent", USER_AGENT);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", request.headers.get("accept") ?? "application/json");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "follow",
  });

  const out = new Headers(cors);
  for (const [key, value] of upstream.headers) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function upstreamUrl(base: string, url: URL, prefix: string): string {
  return base + url.pathname.slice(prefix.length) + url.search;
}

// -- routes -----------------------------------------------------------------

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  await env.STATE.put(`state:${state}`, "1", { expirationTtl: OAUTH_STATE_TTL_SECONDS });

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GH_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", ""); // identity only: we never act as the user
  authorize.searchParams.set("allow_signup", "false");
  return Response.redirect(authorize.toString(), 302);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pages = env.PAGES_URL ?? DEFAULT_PAGES_URL;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const deny = (reason: string) => Response.redirect(`${pages}?denied=${reason}`, 302);

  if (!code || !state) return deny("missing_code");
  const known = await env.STATE.get(`state:${state}`);
  if (!known) return deny("bad_state");
  await env.STATE.delete(`state:${state}`);

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) return deny("no_token");

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenData.access_token}`,
      accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!userResponse.ok) return deny("user_lookup_failed");
  const user = (await userResponse.json()) as { login?: string };
  const login = (user.login ?? "").toLowerCase();
  if (!login || !allowedLogins(env).includes(login)) return deny("1");

  const session = await issueSession(user.login as string, env.SESSION_SECRET);
  return Response.redirect(`${pages}#session=${encodeURIComponent(session)}`, 302);
}

async function handleData(
  request: Request,
  env: Env,
  which: "public" | "private",
  cors: Record<string, string>,
): Promise<Response> {
  if (which === "public") {
    // Static and CDN-cached on Pages; serving it from the GitHub API instead
    // would burn rate limit on an unauthenticated route.
    const pages = env.PAGES_URL ?? DEFAULT_PAGES_URL;
    const upstream = await fetch(new URL("public.json", pages).toString(), {
      headers: { "User-Agent": USER_AGENT },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8", ...cors },
    });
  }

  // private.json is deliberately not on Pages: it carries the lint report,
  // the operation journal and pending updates.
  const upstream = await fetch(
    `https://api.github.com/repos/${ADMIN_REPO}/contents/admin-data/private.json`,
    {
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: "application/vnd.github.raw+json",
        "User-Agent": USER_AGENT,
      },
    },
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/auth/login") return handleLogin(request, env);
    if (url.pathname === "/auth/callback") return handleCallback(request, env);
    if (url.pathname === "/auth/logout") return new Response(null, { status: 204, headers: cors });

    const session = await verifySession(bearer(request), env.SESSION_SECRET);

    if (url.pathname === "/auth/me") {
      return session
        ? json(session, 200, cors)
        : json({ error: "unauthorized" }, 401, cors);
    }

    if (url.pathname === "/data/public.json") return handleData(request, env, "public", cors);

    // Everything below needs a valid session. No exceptions.
    if (!session) return json({ error: "unauthorized" }, 401, cors);

    if (url.pathname === "/data/private.json") return handleData(request, env, "private", cors);

    if (url.pathname.startsWith("/api/gh/")) {
      const path = url.pathname.slice("/api/gh".length) + url.search;
      const permitted = GH_ALLOWLIST.some(
        ([method, pattern]) => method === request.method && pattern.test(path),
      );
      if (!permitted) {
        return json({ error: "forbidden", detail: `${request.method} ${path}` }, 403, cors);
      }
      return proxy(
        request,
        upstreamUrl("https://api.github.com", url, "/api/gh"),
        {
          authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        cors,
      );
    }

    if (url.pathname.startsWith("/api/mr/")) {
      // Modrinth wants a uniquely identifying User-Agent and throttles generic
      // ones; the browser cannot set that header, hence this hop.
      return proxy(request, upstreamUrl("https://api.modrinth.com", url, "/api/mr"), {}, cors);
    }

    if (url.pathname.startsWith("/api/cf/")) {
      return proxy(
        request,
        upstreamUrl("https://api.curseforge.com", url, "/api/cf"),
        { "x-api-key": env.CF_API_KEY },
        cors,
      );
    }

    return json({ error: "not_found" }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

export { ADMIN_REPO, GH_ALLOWLIST, PACK_REPO };
