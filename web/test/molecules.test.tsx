import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RuleLine, StageStep, SupportBar } from "../app/components/ui";

// The brief's sample omits this; without it, the two SupportBar renders (and the
// two StageStep rerenders below) leave stale meters/listitems in the DOM, and
// getByRole("meter") fails with "found multiple elements" in the second test.
afterEach(cleanup);

test("SupportBar is a meter with the commitment over the cost and a percentage", () => {
  render(<SupportBar commitment="1200000000" cost="4000000000" decimals={6} symbol="USDC" />);
  const meter = screen.getByRole("meter");
  expect(meter.getAttribute("aria-valuenow")).toBe("30");
  expect(meter.getAttribute("aria-label")).toBe("Public commitment 1,200 of 4,000 USDC");
  expect(screen.getByText("30% of cost")).toBeTruthy();
});

test("SupportBar caps at 100% and says so", () => {
  render(<SupportBar commitment="5000" cost="4000" decimals={0} symbol="T" />);
  expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
  expect(screen.getByText("Cost covered by public commitments")).toBeTruthy();
});

test("StageStep marks the current step and shows its detail only when current", () => {
  const { rerender } = render(<ul><StageStep label="Open" state="current" showDetail>closes soon</StageStep></ul>);
  const item = screen.getByRole("listitem");
  expect(item.getAttribute("aria-current")).toBe("step");
  expect(screen.getByText("closes soon")).toBeTruthy();
  rerender(<ul><StageStep label="Open" state="done">closes soon</StageStep></ul>);
  expect(screen.queryByText("closes soon")).toBeNull();
  expect(screen.getByRole("listitem").getAttribute("aria-current")).toBeNull();
});

test("RuleLine renders one sentence", () => {
  render(<RuleLine>Deposits do not come back.</RuleLine>);
  expect(screen.getByText("Deposits do not come back.").tagName).toBe("P");
});
