const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "saferoute.token";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function messageFrom(body: unknown, fallback: string): { message: string; code?: string } {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return { message: d };
    if (d && typeof d === "object" && "message" in d) return { message: String((d as { message: unknown }).message), code: (d as { code?: string }).code };
    if (Array.isArray(d) && d[0]?.msg) return { message: String(d[0].msg).replace(/^Value error, /, "") };
  }
  return { message: fallback };
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, "Cannot reach the SafeRoute server. Check that the backend is running.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const { message, code } = messageFrom(data, `Request failed (${res.status})`);
    throw new ApiError(res.status, message, code);
  }
  return data as T;
}

export const assetUrl = (p?: string | null) => (p ? `${BASE}${p}` : undefined);

export function wsUrl(token: string) {
  const origin = BASE || window.location.origin;
  return `${origin.replace(/^http/, "ws")}/ws/alerts?token=${encodeURIComponent(token)}`;
}
