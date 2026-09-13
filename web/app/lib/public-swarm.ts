import type { PrivateStorage } from "./private-proposals";
import { publicReference } from "./swarm";

/** Public reads do not need the identity iframe. Review keys still require ACT. */
export function publicSwarmStorage(
  gateway = import.meta.env.VITE_BEE_URL || "https://api.gateway.ethswarm.org",
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Pick<PrivateStorage, "downloadData" | "downloadFile" | "actDownloadData"> {
  async function download(reference: string, route: "bytes" | "bzz") {
    const ref = publicReference(reference).slice(2);
    const response = await fetchFn(
      `${gateway.replace(/\/+$/, "")}/${route}/${ref}${route === "bzz" ? "/" : ""}`,
      { signal: AbortSignal.timeout(30_000), credentials: "omit" },
    );
    if (!response.ok) {
      throw new Error(`Swarm could not load this content (${response.status}). Try again shortly.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  return {
    downloadData: (reference) => download(reference, "bytes"),
    downloadFile: async (reference) => ({ name: "attachment", data: await download(reference, "bzz") }),
    actDownloadData: async () => {
      throw new Error("Connect the proposer’s or organizer’s Swarm ID to read private proposals.");
    },
  };
}
