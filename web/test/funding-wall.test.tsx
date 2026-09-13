import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FundingWall } from "../app/components/round/funding-wall";
import { abandonedSnapshot, arkivSnapshot, attestedSnapshot, openSnapshot, paidSnapshot, provenSnapshot, provingNoirSnapshot } from "./fixtures/snapshots";

afterEach(cleanup);
const amountRows = () => within(screen.getByRole("list", { name: "Proposal funding amounts" })).getAllByRole("listitem");

test("the public view shows exact asking amounts, support and undecided allocations with round-scoped links", () => {
  render(<MemoryRouter><FundingWall snapshot={openSnapshot} /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Proposal funding" })).toBeTruthy();
  const row = within(amountRows()[0]);
  expect(row.getByRole("link", { name: "Formal audit of the tally" }).getAttribute("href")).toBe(`/project/0?pool=${openSnapshot.pool}`);
  expect(row.getByText("Asking").nextElementSibling?.textContent).toBe("4,000 USDC");
  expect(row.getByText("Receiving").nextElementSibling?.textContent).toBe("Not decided");
  expect(row.getByText(/Public support:/).textContent).toContain("300 USDC");
  expect(screen.getByText(/tied choices can share the same support/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Project 2" })).toBeTruthy();
});

test("projections show full awards, not just first-choice support, and identify stale data", () => {
  render(<MemoryRouter><FundingWall snapshot={arkivSnapshot} live={{ commitments: ["100000000", "0"], funded: [0], block: 100 }} /></MemoryRouter>);
  const row = within(amountRows()[0]);
  expect(row.getByText("Receiving").nextElementSibling?.textContent).toBe("4,000 USDC");
  expect(row.getByText("Projected funding")).toBeTruthy();
  expect(screen.getByText(/Receiving amounts are projections from public ballots, not payments/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("block 100");
});

test.each([provenSnapshot, attestedSnapshot, paidSnapshot, abandonedSnapshot])("completed $finality rounds show allocations and payment status", (snapshot) => {
  render(<MemoryRouter><FundingWall snapshot={snapshot} /></MemoryRouter>);
  const row = within(amountRows()[0]);
  const abandoned = snapshot.finality === "abandoned";
  expect(row.getByText("Receiving").nextElementSibling?.textContent).toBe(abandoned ? "0 USDC" : "4,000 USDC");
  expect(row.getByText(abandoned ? "Round abandoned" : snapshot.projects[0].claimed ? "Paid" : "Awaiting payment")).toBeTruthy();
  expect(screen.queryByText(/Public support:/)).toBeNull();
  if (snapshot.finality === "attested") expect(screen.getByText("Provisional allocation")).toBeTruthy();
});

test("loading and failed public funding leave asking amounts visible and allocations unknown", () => {
  const { rerender } = render(<MemoryRouter><FundingWall snapshot={arkivSnapshot} /></MemoryRouter>);
  expect(screen.getByRole("status").textContent).toContain("Computing public funding");
  expect(within(amountRows()[0]).getByText("Not decided")).toBeTruthy();
  rerender(<MemoryRouter><FundingWall snapshot={arkivSnapshot} liveError /></MemoryRouter>);
  expect(screen.getByRole("status").textContent).toContain("Public funding is unavailable");
  expect(within(amountRows()[0]).getByTitle("4000 USDC")).toBeTruthy();
  rerender(<MemoryRouter><FundingWall snapshot={provingNoirSnapshot} /></MemoryRouter>);
  expect(screen.getByText(/Public support is unavailable for this pool variant/)).toBeTruthy();
});

test("empty rounds and zero-cost proposals keep a readable alternative to the treemap", () => {
  const { rerender } = render(<MemoryRouter><FundingWall snapshot={{ ...openSnapshot, projects: [] }} /></MemoryRouter>);
  expect(screen.getByText(/Accepted proposals will appear here/)).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  rerender(<MemoryRouter><FundingWall snapshot={{ ...openSnapshot, projects: [{ ...openSnapshot.projects[0], cost: "0" }] }} /></MemoryRouter>);
  expect(within(amountRows()[0]).getByText("Asking").nextElementSibling?.textContent).toBe("0 USDC");
});

test("small token amounts remain readable without hovering for hidden decimals", () => {
  render(<MemoryRouter><FundingWall snapshot={{ ...provenSnapshot, projects: [{ ...provenSnapshot.projects[0], cost: "1" }] }} /></MemoryRouter>);
  const row = within(amountRows()[0]);
  expect(row.getByText("Asking").nextElementSibling?.textContent).toBe("0.000001 USDC");
  expect(row.getByText("Receiving").nextElementSibling?.textContent).toBe("0.000001 USDC");
});
