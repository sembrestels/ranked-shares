import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { Board } from "../app/components/round/board";
import { SealedPanel } from "../app/components/round/sealed-panel";
import { YourBallot } from "../app/components/round/your-ballot";
import { Outcome } from "../app/components/round/outcome";
import { RoundHeading } from "../app/components/round/round-heading";
import { abandonedSnapshot, arkivSnapshot, attestedSnapshot, DEADLINE, NOW, openSnapshot, provenSnapshot, provingNoirSnapshot } from "./fixtures/snapshots";

afterEach(cleanup);

const inRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("Board lists projects by public commitment, descending, with name, cost, and commitment", () => {
  inRouter(<Board snapshot={openSnapshot} />);
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole("link").textContent).toBe("Project 2");
  expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/project/1");
  expect(within(rows[0]).getByTitle("1000 USDC").textContent).toBe("1,000 USDC");
  expect(within(rows[1]).getByRole("link").textContent).toBe("Formal audit of the tally");
  expect(within(rows[1]).getByTitle("4000 USDC").textContent).toBe("4,000 USDC");
  expect(within(rows[1]).getByRole("meter").getAttribute("aria-valuenow")).toBe("8");
});

test("Board shows the funded badge once the outcome is set", () => {
  inRouter(<Board snapshot={provenSnapshot} />);
  expect(screen.getByText("Funded")).toBeTruthy();
});

test("Board takes browser-computed commitments for an Arkiv pool", () => {
  inRouter(<Board snapshot={arkivSnapshot} commitments={["250000000", "900000000"]} />);
  const rows = screen.getAllByRole("listitem");
  expect(within(rows[0]).getByRole("link").textContent).toBe("Project 2");
  expect(within(rows[0]).getByTitle("900 USDC")).toBeTruthy();
  expect(within(rows[1]).getByTitle("250 USDC")).toBeTruthy();
});

test("Board says commitments are still loading for an Arkiv pool without them", () => {
  inRouter(<Board snapshot={arkivSnapshot} />);
  expect(screen.getByText(/Public commitments are being computed from Arkiv/)).toBeTruthy();
});

test("SealedPanel shows the sealed weight and count, and the noir caveat", () => {
  const { rerender } = render(<SealedPanel snapshot={openSnapshot} />);
  expect(screen.getByText("Sealed weight").nextSibling?.textContent).toBe("500 USDC");
  expect(screen.getByText("Sealed ballots").nextSibling?.textContent).toBe("1");
  rerender(<SealedPanel snapshot={provingNoirSnapshot} />);
  expect(screen.getByText(/Public commitments are not available for this pool variant/)).toBeTruthy();
});

test("YourBallot: not cast, sealed in the roster, public and final", () => {
  const { rerender } = inRouter(
    <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "300000000", seats: "0", total: "300000000" }, ballot: { public: null, sealed: false }, inRoster: true }} />,
  );
  expect(screen.getByText("Your ballot: not cast. Money without a ballot funds nothing.")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/vote");
  rerender(
    <MemoryRouter>
      <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "0", seats: "500000000", total: "500000000" }, ballot: { public: null, sealed: true }, inRoster: true }} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Your ballot: sealed, in the roster, replaceable until/).textContent).toContain(new Date(DEADLINE * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  expect(screen.getByRole("link").getAttribute("href")).toBe("/ballot");
  rerender(
    <MemoryRouter>
      <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "300000000", seats: "0", total: "300000000" }, ballot: { public: { ranks: [2, 1] }, sealed: false }, inRoster: true }} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Your ballot: public and final/)).toBeTruthy();
});

test("YourBallot renders nothing for an address with no weight and no ballot", () => {
  const { container } = inRouter(
    <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "0", seats: "0", total: "0" }, ballot: { public: null, sealed: false }, inRoster: false }} />,
  );
  expect(container.textContent).toBe("");
});

test("Outcome lists the funded set in order, the finality in words, and the audit link", () => {
  const { rerender } = inRouter(<Outcome snapshot={provenSnapshot} />);
  expect(screen.getByText("Proven")).toBeTruthy();
  expect(screen.getByText(/the sealed ballots were proven against their commitments/)).toBeTruthy();
  const funded = screen.getByRole("list", { name: "Funded projects" });
  expect(within(funded).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Formal audit of the tally, 4,000 USDC"]);
  expect(screen.getByText("Project 2, not funded")).toBeTruthy();
  expect(screen.getByRole("link", { name: "check this result yourself" }).getAttribute("href")).toBe("https://github.com/sembrestels/ranked-shares#sealed-pools");
  rerender(<MemoryRouter><Outcome snapshot={attestedSnapshot} /></MemoryRouter>);
  expect(screen.getByText("Provisional")).toBeTruthy();
  expect(screen.getByText(/accepted after the proof grace period without a proof; the funded set stands/)).toBeTruthy();
  rerender(<MemoryRouter><Outcome snapshot={abandonedSnapshot} /></MemoryRouter>);
  expect(screen.getByText("Abandoned")).toBeTruthy();
  expect(screen.getByText(/no project is funded and the organiser can sweep the pool/)).toBeTruthy();
});

test("RoundHeading names the round, the pool total, and when the snapshot was taken", () => {
  render(<RoundHeading snapshot={openSnapshot} now={NOW} name="Autumn grants" />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Autumn grants");
  expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("1,300 USDC in the pool");
  expect(screen.getByText("Updated 12 seconds ago")).toBeTruthy();
});
