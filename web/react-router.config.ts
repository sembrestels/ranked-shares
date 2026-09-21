import type { Config } from "@react-router/dev/config";
import { buildPool, projectIds } from "./app/lib/build-chain";

const FIXED = ["/", "/round", "/proposals", "/vote", "/liquidity", "/submit", "/setup", "/deploy", "/import", "/onepager"];
// react-router's ssr:false build refuses to compile ANY route whose module has
// a `loader` export unless at least one prerendered path resolves to it (see
// https://reactrouter.com/how-to/pre-rendering#invalid-exports) — regardless
// of clientLoader. app/routes/project.tsx always exports a build-time loader,
// so a fallback path keeps the build valid when no real project id is known
// yet; its loader already returns null without a pool, so this prerenders
// with generic fallback meta rather than crashing the build.
const FALLBACK_PROJECT = "/project/0";

export default {
  ssr: false,
  async prerender() {
    const cfg = buildPool();
    if (!cfg) {
      console.warn(
        "prerender: VITE_POOL_ADDRESS is not set; no project ids are known, prerendering the placeholder /project/0 instead",
      );
      return [...FIXED, FALLBACK_PROJECT];
    }
    try {
      const ids = await projectIds(cfg);
      return [...FIXED, ...(ids.length ? ids.map((id) => `/project/${id}`) : [FALLBACK_PROJECT])];
    } catch (e) {
      console.warn(
        `prerender: chain read failed, no project ids are known, prerendering the placeholder /project/0 instead: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [...FIXED, FALLBACK_PROJECT];
    }
  },
} satisfies Config;
