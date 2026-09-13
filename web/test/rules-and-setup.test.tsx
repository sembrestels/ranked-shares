import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RulesPanel } from "../app/components/proposals/rules-panel";
import { AddProjectForm } from "../app/components/setup/add-project-form";

afterEach(cleanup);

test("RulesPanel states the all-or-nothing rule, the token, and the closing date", () => {
  render(<RulesPanel symbol="USDC" deadline={1_700_003_600} />);
  expect(screen.getByText("Funded at exactly the amount you ask for, or not at all.")).toBeTruthy();
  expect(screen.getByText(/Amounts are in USDC/)).toBeTruthy();
  expect(screen.getByText(/Submissions close when voting opens/).textContent).toContain(new Date(1_700_003_600 * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
});

test("AddProjectForm submits the parsed cost and the recipient", () => {
  const onSubmit = vi.fn();
  render(<AddProjectForm symbol="USDC" decimals={6} disabled={false} busy={false} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Cost (USDC)"), { target: { value: "4000" } });
  fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" } });
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  expect(onSubmit).toHaveBeenCalledWith(4_000_000_000n, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
});

test("AddProjectForm refuses a bad address or amount without submitting", () => {
  const onSubmit = vi.fn();
  render(<AddProjectForm symbol="USDC" decimals={6} disabled={false} busy={false} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Cost (USDC)"), { target: { value: "4000" } });
  fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: "0x12" } });
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/address/i);
});
