import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Address, Badge, Countdown, Money, Skeleton } from "../app/components/ui";

test("Money shows a rounded amount with the symbol and the exact value in the title", () => {
  render(<Money amount="1234567890" decimals={6} symbol="USDC" />);
  const el = screen.getByTitle("1234.56789 USDC");
  expect(el.textContent).toBe("1,234.56 USDC");
});

test("Address shortens by default, shows the full value on request, and copies", async () => {
  const { rerender } = render(<Address address="0x5fbdb2315678afecb367f032d93f642f64180aa3" />);
  expect(screen.getByText("0x5FbD…0aa3").getAttribute("title")).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
  rerender(<Address address="0x5fbdb2315678afecb367f032d93f642f64180aa3" full copy />);
  expect(screen.getByText("0x5FbDB2315678afecb367f032d93F642f64180aa3")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

test("Countdown renders the remaining time with an ISO dateTime", () => {
  render(<Countdown to={1_700_000_000 + 2 * 86400 + 3 * 3600} now={1_700_000_000} />);
  const t = screen.getByText("2 days 3 hours");
  expect(t.tagName).toBe("TIME");
  expect(t.getAttribute("dateTime")).toBe(new Date((1_700_000_000 + 2 * 86400 + 3 * 3600) * 1000).toISOString());
});

test("Badge carries its text and tone; Skeleton is hidden from assistive tech", () => {
  render(<Badge tone="success">Accepted</Badge>);
  expect(screen.getByText("Accepted").className).toContain("text-success");
  const { container } = render(<Skeleton lines={2} />);
  expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
});
