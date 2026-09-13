/** Display formatting. Amounts keep the exact value in `full`; `shown` is for the eye. */
import { formatUnits, getAddress } from "viem";

export function formatAmount(amount: string | bigint, decimals: number, maxFraction = 2) {
  const full = formatUnits(BigInt(amount), decimals);
  const [int, frac = ""] = full.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cut = frac.slice(0, maxFraction).replace(/0+$/, "");
  return { shown: cut ? `${grouped}.${cut}` : grouped, full };
}

export function shortAddress(address: string): string {
  const a = getAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
  if (h > 0) return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m > 0) return unit(m, "minute");
  return "less than a minute";
}

export function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

export function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${unit(m, "minute")} ago`;
  return `${unit(Math.floor(m / 60), "hour")} ago`;
}
