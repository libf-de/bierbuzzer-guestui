import { Request } from "express";
import { AdminIdentity, AuthProvider } from "./types";

interface JsonResponse {
  status: number;
  json: any;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<JsonResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticate against the external alleskasse API: POST {username, password}
 * to the login URL. On `status === "ok"` returns the apiKey (== accountId).
 * Returns null on bad credentials or a malformed response.
 */
export async function externalLogin(
  loginUrl: string,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<string | null> {
  const { json } = await postJson(loginUrl, { username, password }, timeoutMs);
  if (json && json.status === "ok" && typeof json.apiKey === "string" && json.apiKey) {
    return json.apiKey;
  }
  return null;
}

interface ExternalAuthOptions {
  checkUrl: string;
  cacheTtlMs: number;
  timeoutMs: number;
}

/**
 * Verifies a Bearer apiKey by POSTing it to the external checkLogin endpoint
 * (HTTP 200 + JSON customerFound === true). Successful checks are cached
 * briefly to avoid a round-trip on every admin request.
 */
interface CacheEntry {
  exp: number;
  name?: string;
}

export class ExternalAuthProvider implements AuthProvider {
  readonly scheme = "Bearer";
  private readonly cache = new Map<string, CacheEntry>(); // apiKey -> {expiresAt, name}

  constructor(private readonly opts: ExternalAuthOptions) {}

  async authenticate(req: Request): Promise<AdminIdentity | null> {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) return null;
    const apiKey = header.slice(7).trim();
    if (!apiKey) return null;
    const entry = await this.verify(apiKey);
    return entry ? { accountId: apiKey, name: entry.name } : null;
  }

  private async verify(apiKey: string): Promise<CacheEntry | null> {
    const now = Date.now();
    const cached = this.cache.get(apiKey);
    if (cached && cached.exp > now) return cached;

    const { status, json } = await postJson(this.opts.checkUrl, { apiKey }, this.opts.timeoutMs);
    if (status !== 200 || json?.customerFound !== true) return null;

    const entry: CacheEntry = {
      exp: now + this.opts.cacheTtlMs,
      name: typeof json?.name === "string" ? json.name : undefined,
    };
    this.cache.set(apiKey, entry);
    return entry;
  }
}
