/** Proposal content by Swarm reference: fetched from a Bee node's /bytes
 * endpoint, parsed with the browser's parser, cached forever because a
 * reference is the content's hash. Spec decision 8. */
import type { Hex } from "viem";
import { parseContent, type ProposalContent } from "../../app/lib/swarm.ts";

export interface Resolved {
  status: "ok" | "none" | "unavailable";
  content: ProposalContent | null;
  reason: string | null;
}
export interface Content {
  get(ref: Hex): Promise<Resolved>;
}

const ZERO = "0x" + "00".repeat(32);

export function createContent(
  opts: { beeUrl: string | null; fetch: typeof fetch; timeoutMs: number },
): Content {
  const cache = new Map<string, ProposalContent>();
  const unavailable = (reason: string): Resolved => ({
    status: "unavailable",
    content: null,
    reason,
  });
  return {
    async get(ref) {
      if (ref.toLowerCase() === ZERO) return { status: "none", content: null, reason: null };
      if (!opts.beeUrl) return unavailable("no gateway configured");
      const key = ref.toLowerCase();
      const hit = cache.get(key);
      if (hit) return { status: "ok", content: hit, reason: null };
      let res: Response;
      try {
        res = await opts.fetch(`${opts.beeUrl}/bytes/${key.slice(2)}`, {
          headers: { Accept: "application/octet-stream" },
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (e) {
        return unavailable(`gateway unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) return unavailable(`gateway answered ${res.status}`);
      try {
        const content = parseContent(new Uint8Array(await res.arrayBuffer()));
        cache.set(key, content);
        return { status: "ok", content, reason: null };
      } catch (e) {
        return unavailable(`content unreadable: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
