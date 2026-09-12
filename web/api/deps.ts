import type { PublicClient } from "viem";
import type { Config } from "./config.ts";
import type { Snapshots } from "./services/snapshot.ts";

/** Everything a route needs, built once in bootstrap.ts and faked in tests. */
export interface Deps {
  config: Config;
  client: PublicClient;
  snapshots: Snapshots;
  now: () => number;
  log: (msg: string) => void;
}
