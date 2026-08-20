import assert from "node:assert/strict";
import test from "node:test";

import { GH_ALLOWLIST, issueSession, verifySession } from "../src/index.ts";

const SECRET = "test-secret-do-not-use-in-production";

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

test("a fresh session round-trips", async () => {
  const token = await issueSession("lndieGamer", SECRET);
  const payload = await verifySession(token, SECRET);
  assert.equal(payload?.login, "lndieGamer");
  assert.ok(payload!.exp > Math.floor(Date.now() / 1000));
});

test("a session signed with another secret is rejected", async () => {
  const token = await issueSession("lndieGamer", SECRET);
  assert.equal(await verifySession(token, "some-other-secret"), null);
});

test("tampering with the payload invalidates the signature", async () => {
  const token = await issueSession("lndieGamer", SECRET);
  const [, signature] = token.split(".");
  const forged = base64urlEncode(
    JSON.stringify({ login: "attacker", iat: 0, exp: 9999999999 }),
  );
  assert.equal(await verifySession(`${forged}.${signature}`, SECRET), null);
});

test("an expired session is rejected even though it is correctly signed", async () => {
  // Sign an already-expired payload with the real key: only the exp check catches it.
  const body = base64urlEncode(
    JSON.stringify({ login: "lndieGamer", iat: 0, exp: Math.floor(Date.now() / 1000) - 1 }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  ).toString("base64url");
  assert.equal(await verifySession(`${body}.${signature}`, SECRET), null);
});

test("malformed tokens are rejected without throwing", async () => {
  for (const token of [null, "", "nodot", "a.b", "....", "!!!.???"]) {
    assert.equal(await verifySession(token, SECRET), null, `should reject ${token}`);
  }
});

const permitted = (method: string, path: string) =>
  GH_ALLOWLIST.some(([m, pattern]) => m === method && pattern.test(path));

test("the GitHub allowlist admits exactly what the panel needs", () => {
  assert.ok(permitted("GET", "/repos/lndieGamer/MCKSP-Seventh-Season/contents/mods"));
  assert.ok(permitted("GET", "/repos/lndieGamer/mcksp-admin/contents/admin-data/public.json"));
  assert.ok(permitted("GET", "/repos/lndieGamer/mcksp-admin/actions/runs?event=workflow_dispatch"));
  assert.ok(permitted("GET", "/repos/lndieGamer/mcksp-admin/actions/runs/123/jobs"));
  assert.ok(
    permitted("POST", "/repos/lndieGamer/mcksp-admin/actions/workflows/mutate.yml/dispatches"),
  );
  assert.ok(
    permitted("POST", "/repos/lndieGamer/mcksp-admin/actions/workflows/analyze.yml/dispatches"),
  );
  assert.ok(permitted("GET", "/repos/lndieGamer/MCKSP-Seventh-Season/commits?per_page=50"));
});

test("the GitHub allowlist is not a general tunnel", () => {
  assert.ok(!permitted("GET", "/user"));
  assert.ok(!permitted("GET", "/repos/someoneelse/private/contents/"));
  assert.ok(!permitted("DELETE", "/repos/lndieGamer/mcksp-admin/contents/admin-data/public.json"));
  assert.ok(!permitted("POST", "/repos/lndieGamer/mcksp-admin/actions/workflows/pages.yml/dispatches"));
  // Reading the pack's contents is fine; writing to it through this proxy is not.
  assert.ok(!permitted("PUT", "/repos/lndieGamer/MCKSP-Seventh-Season/contents/pack.toml"));
});
