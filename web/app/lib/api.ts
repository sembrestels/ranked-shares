/** The read API client. Same origin by default; VITE_API_URL points a build at a remote API. */
import type { ProjectResponse, RoundSnapshot, VoterResponse } from "./api-types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const base = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

function url(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return `${base}${path}${s ? `?${s}` : ""}`;
}

async function getJson<T>(
  path: string,
  params: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchFn(url(path, params));
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const afterParam = (after?: number) => (after === undefined ? undefined : String(after));

export const fetchRound = (pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<RoundSnapshot>("/api/round", { pool, after: afterParam(after) }, fetchFn);
export const fetchProject = (id: number, pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<ProjectResponse>(`/api/project/${id}`, { pool, after: afterParam(after) }, fetchFn);
export const fetchVoter = (address: string, pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<VoterResponse>(`/api/voter/${address}`, { pool, after: afterParam(after) }, fetchFn);
