import { expect, test } from "vitest";
import { projectMetaTags, roundMetaTags } from "../app/lib/meta";

test("project meta uses the pitch title, names the cost, and sets a canonical URL", () => {
  const tags = projectMetaTags({ title: "Formal audit of the tally", cost: "4000000000", decimals: 6, symbol: "USDC" }, 3, "https://ranked.example");
  expect(tags).toContainEqual({ title: "Formal audit of the tally · RankedShares" });
  expect(tags).toContainEqual({ property: "og:title", content: "Formal audit of the tally" });
  expect(tags).toContainEqual({ name: "description", content: "A project asking for 4,000 USDC in a RankedShares funding round." });
  expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://ranked.example/project/3" });
});

test("project meta without data falls back to the id", () => {
  expect(projectMetaTags(null, 3, "https://ranked.example")).toContainEqual({ property: "og:title", content: "Project 4" });
});

test("round meta names the round and the deadline", () => {
  const tags = roundMetaTags({ name: "Autumn grants", votingDeadline: 1_700_003_600 }, "https://ranked.example");
  expect(tags).toContainEqual({ property: "og:title", content: "Autumn grants" });
  expect(tags.find((t): t is { name: string; content: string } => "name" in t && t.name === "description")?.content).toMatch(/Voting closes on /);
  expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://ranked.example/round" });
});

test("round canonical links preserve the selected round", () => {
  const pool = "0x0000000000000000000000000000000000000002";
  expect(roundMetaTags(null, "https://ranked.example", pool)).toContainEqual({ tagName: "link", rel: "canonical", href: `https://ranked.example/round?pool=${pool}` });
});
