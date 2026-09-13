import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectSummary } from "../app/components/project/project-summary";
import { Pitch } from "../app/components/project/pitch";
import type { ProjectResponse } from "../app/lib/api-types";
import { openSnapshot, provenSnapshot } from "./fixtures/snapshots";

afterEach(cleanup);

const slice = (s: typeof openSnapshot) => ({ pool: s.pool, kind: s.kind, block: s.block, at: s.at, token: s.token, phase: s.phase, finality: s.finality, stage: s.stage });
const withPitch: ProjectResponse = {
  project: openSnapshot.projects[0],
  round: slice(openSnapshot),
  contentStatus: "ok",
  content: { version: 1, title: "Formal audit of the tally", body: "Line one\n<b>not html</b>", attachments: [{ reference: "ab".repeat(32), name: "plan.pdf", type: "application/pdf", size: 20480 }] },
  reason: null,
};

test("ProjectSummary shows cost, public commitment, recipient in full with copy, and the meter", () => {
  render(<ProjectSummary response={withPitch} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Formal audit of the tally");
  expect(screen.getByText("Cost").nextSibling?.textContent).toBe("4,000 USDC");
  expect(screen.getByText("Public commitment").nextSibling?.textContent).toBe("300 USDC");
  expect(screen.getByText("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("meter")).toBeTruthy();
});

test("ProjectSummary states the outcome for a funded project", () => {
  render(<ProjectSummary response={{ ...withPitch, project: provenSnapshot.projects[0], round: slice(provenSnapshot) }} />);
  expect(screen.getByText("Funded")).toBeTruthy();
  expect(screen.getByText("Proven")).toBeTruthy();
});

test("Pitch renders the body as text, never HTML, and lists attachments with a download", () => {
  const onDownload = vi.fn();
  render(<Pitch response={withPitch} onRetry={() => {}} onDownload={onDownload} />);
  const body = screen.getByText(/Line one/);
  expect(body.textContent).toContain("<b>not html</b>");
  expect(body.querySelector("b")).toBeNull();
  expect(screen.getByText("plan.pdf")).toBeTruthy();
  expect(screen.getByText("20 KB")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Download plan.pdf" }));
  expect(onDownload).toHaveBeenCalledWith(withPitch.content!.attachments[0]);
});

test("Pitch explains a missing pitch and offers a retry when it could not be loaded", () => {
  const onRetry = vi.fn();
  const { rerender } = render(<Pitch response={{ ...withPitch, contentStatus: "none", content: null }} onRetry={onRetry} onDownload={() => {}} />);
  expect(screen.getByText("No pitch was published for this project")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  rerender(<Pitch response={{ ...withPitch, contentStatus: "unavailable", content: null, reason: "gateway answered 504" }} onRetry={onRetry} onDownload={() => {}} />);
  expect(screen.getByText("The pitch could not be loaded; try again")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
});
