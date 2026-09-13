import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StageBar } from "../app/components/stage/stage-bar";
import {
  abandonedSnapshot, attestedSnapshot, closingSnapshot, DEADLINE, NOW, openSnapshot, paidSnapshot,
  plainTallySnapshot, provenSnapshot, provingNoirSnapshot, provingZiskSnapshot, setupSnapshot,
} from "./fixtures/snapshots";

afterEach(cleanup);

const bar = (snapshot: typeof openSnapshot, extra: Partial<Parameters<typeof StageBar>[0]> = {}) =>
  render(<StageBar snapshot={snapshot} now={NOW} canClose={false} closing={false} {...extra} />);

test("lists the seven steps and marks open as current with the deadline", () => {
  bar(openSnapshot);
  const nav = screen.getByRole("navigation", { name: "Round stage" });
  expect(within(nav).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 5))).toHaveLength(7);
  const current = within(nav).getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
  expect(current).toHaveLength(1);
  expect(current[0].textContent).toContain("Open");
  expect(current[0].textContent).toContain("Voting closes in 1 hour");
  expect(current[0].textContent).toContain("voting closes on");
  expect(current[0].querySelectorAll("time")[1].getAttribute("dateTime")).toBe(new Date(DEADLINE * 1000).toISOString());
});

test("setup marks proposals and setup current and shows the detail once", () => {
  bar(setupSnapshot);
  const current = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
  expect(current.map((li) => li.textContent?.startsWith("Proposals") || li.textContent?.startsWith("Setup"))).toEqual([true, true]);
  expect(screen.getAllByText(/Submissions close on/)).toHaveLength(1);
});

test("closing shows roster progress and the close button only when a wallet can act", () => {
  const onCloseBatch = vi.fn();
  const { rerender } = bar(closingSnapshot, { canClose: true, onCloseBatch });
  expect(screen.getByText("1 of 2 voters closed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close next batch" }));
  expect(onCloseBatch).toHaveBeenCalledOnce();
  rerender(<StageBar snapshot={closingSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.queryByRole("button", { name: "Close next batch" })).toBeNull();
  rerender(<StageBar snapshot={{ ...closingSnapshot, closing: { closed: true, cursor: 2 } }} now={NOW} canClose closing={false} onCloseBatch={onCloseBatch} />);
  expect(screen.queryByRole("button", { name: "Close next batch" })).toBeNull();
});

test("proving shows progress or the waiting sentence, and the grace dates", () => {
  const { rerender } = bar(provingZiskSnapshot);
  expect(screen.getByText(/waiting for the first proof/i)).toBeTruthy();
  expect(screen.getByText(/abandonment possible from/i)).toBeTruthy();
  expect(screen.queryByText(/provisional result possible from/i)).toBeNull();
  rerender(<StageBar snapshot={provingNoirSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("1 of 4 proof batches accepted")).toBeTruthy();
  expect(screen.getByText(/provisional result possible from/i)).toBeTruthy();
  rerender(<StageBar snapshot={plainTallySnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("2 tally steps accepted")).toBeTruthy();
  expect(screen.getByText("Counting")).toBeTruthy();
});

test("done stages carry the finality label and the paid state", () => {
  const { rerender } = bar(provenSnapshot);
  expect(screen.getByText("Proven")).toBeTruthy();
  expect(screen.getByText("1 of 2 projects funded")).toBeTruthy();
  rerender(<StageBar snapshot={paidSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("All funded projects have been paid")).toBeTruthy();
  rerender(<StageBar snapshot={attestedSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("Provisional")).toBeTruthy();
  rerender(<StageBar snapshot={abandonedSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("Abandoned")).toBeTruthy();
});

test("a close error is announced", () => {
  bar(closingSnapshot, { canClose: true, closeError: "User rejected the request." });
  expect(screen.getByRole("alert").textContent).toContain("User rejected the request.");
});
