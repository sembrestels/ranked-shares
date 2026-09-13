import { expect, test } from "vitest";
import { formatAgo, formatAmount, formatDuration, shortAddress } from "../app/lib/format";

test("formatAmount groups thousands, trims to two decimals, keeps the exact value", () => {
  expect(formatAmount("4000000000", 6)).toEqual({ shown: "4,000", full: "4000" });
  expect(formatAmount("1234567890", 6)).toEqual({ shown: "1,234.56", full: "1234.56789" });
  expect(formatAmount("1000000", 6)).toEqual({ shown: "1", full: "1" });
  expect(formatAmount("5", 6).shown).toBe("0");
  expect(formatAmount("5", 6).full).toBe("0.000005");
  expect(formatAmount(1500n, 0, 2).shown).toBe("1,500");
});

test("shortAddress checksums and shortens", () => {
  expect(shortAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3")).toBe("0x5FbD…0aa3");
});

test("formatDuration reads like a sentence", () => {
  expect(formatDuration(2 * 86400 + 3 * 3600 + 40)).toBe("2 days 3 hours");
  expect(formatDuration(86400)).toBe("1 day");
  expect(formatDuration(3 * 3600 + 12 * 60)).toBe("3 hours 12 minutes");
  expect(formatDuration(59)).toBe("less than a minute");
  expect(formatDuration(0)).toBe("ended");
});

test("formatAgo", () => {
  expect(formatAgo(3)).toBe("just now");
  expect(formatAgo(45)).toBe("45 seconds ago");
  expect(formatAgo(61)).toBe("1 minute ago");
  expect(formatAgo(7200)).toBe("2 hours ago");
});
