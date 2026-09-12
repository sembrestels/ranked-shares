import type { Config } from "./config.ts";

/** Everything a route needs, built once in bootstrap.ts and faked in tests. */
export interface Deps {
  config: Config;
  now: () => number;
  log: (msg: string) => void;
}
