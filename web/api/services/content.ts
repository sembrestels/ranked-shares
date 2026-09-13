/** Proposal content by Swarm reference: fetched from a Bee node's /bytes
 * endpoint, parsed with the browser's parser, cached forever because a
 * reference is the content's hash. Spec decision 8. */
import type { Hex } from "viem";
import { parseContent, type ProposalContent } from "../../app/lib/swarm.ts";
import {
  decryptProposal,
  parsePrivateDescriptor,
  ZERO_KEY,
} from "../../app/lib/private-proposals.ts";

export interface Resolved {
  status: "ok" | "none" | "unavailable" | "private";
  content: ProposalContent | null;
  reason: string | null;
}
export interface Content {
  get(ref: Hex, publishedKey?: Hex): Promise<Resolved>;
}

const ZERO = "0x" + "00".repeat(32);

/** How long a failed fetch is remembered, so a dead gateway does not add its
 * full timeout to every snapshot refresh. */
export const NEGATIVE_TTL_MS = 60_000;
/** Refuse to read a declared body past this size; the content is discarded
 * as unavailable rather than a bound-sized read being attempted. */
export const MAX_CONTENT_BYTES = 2_000_000;
/** How many failed references to remember at once, so a burst of distinct
 * bad references cannot grow the negative cache without bound. */
export const MAX_NEGATIVE = 1_000;

export function createContent(
  opts: { beeUrl: string | null; fetch: typeof fetch; timeoutMs: number; now: () => number },
): Content {
  const cache = new Map<string, ProposalContent>();
  const negative = new Map<string, { result: Resolved; at: number }>();
  const unavailable = (reason: string): Resolved => ({
    status: "unavailable",
    content: null,
    reason,
  });
  const remember = (key: string, result: Resolved): Resolved => {
    if (!negative.has(key) && negative.size >= MAX_NEGATIVE) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of negative) {
        if (v.at < oldestAt) {
          oldestAt = v.at;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) negative.delete(oldestKey);
    }
    negative.set(key, { result, at: opts.now() });
    return result;
  };
  return {
    async get(ref, publishedKey) {
      if (ref.toLowerCase() === ZERO) return { status: "none", content: null, reason: null };
      if (!opts.beeUrl) return unavailable("no gateway configured");
      const key = `${ref.toLowerCase()}:${publishedKey ?? ZERO_KEY}`;
      const hit = cache.get(key);
      if (hit) return { status: "ok", content: hit, reason: null };
      const negHit = negative.get(key);
      if (negHit && (opts.now() - negHit.at) * 1000 < NEGATIVE_TTL_MS) return negHit.result;
      let res: Response;
      try {
        res = await opts.fetch(`${opts.beeUrl}/bytes/${ref.slice(2)}`, {
          headers: { Accept: "application/octet-stream" },
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (e) {
        return remember(
          key,
          unavailable(`gateway unreachable: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
      if (!res.ok) return remember(key, unavailable(`gateway answered ${res.status}`));
      const declaredLength = res.headers.get("content-length");
      if (declaredLength !== null && Number(declaredLength) > MAX_CONTENT_BYTES) {
        await res.body?.cancel();
        return remember(key, unavailable("content too large"));
      }
      try {
        let data = new Uint8Array(await res.arrayBuffer());
        const descriptor = parsePrivateDescriptor(data);
        if (descriptor) {
          if (!publishedKey || publishedKey === ZERO_KEY) {
            return {
              status: "private",
              content: null,
              reason: "This proposal is private until voting opens.",
            };
          }
          data = await decryptProposal(
            {
              downloadData: async (reference) => {
                const payload = await opts.fetch(`${opts.beeUrl}/bytes/${reference}`, {
                  signal: AbortSignal.timeout(opts.timeoutMs),
                });
                if (!payload.ok) throw new Error(`gateway answered ${payload.status}`);
                if (Number(payload.headers.get("content-length")) > MAX_CONTENT_BYTES) {
                  await payload.body?.cancel();
                  throw new Error("content too large");
                }
                return new Uint8Array(await payload.arrayBuffer());
              },
            },
            descriptor,
            publishedKey,
          );
        }
        const content = parseContent(data);
        cache.set(key, content);
        negative.delete(key);
        return { status: "ok", content, reason: null };
      } catch (e) {
        return remember(
          key,
          unavailable(`content unreadable: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    },
  };
}
