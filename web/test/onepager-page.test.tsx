import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "../app/components/onepager/stepper";
import { Playground } from "../app/components/onepager/playground";
import { ThemeToggle } from "../app/components/onepager/theme-toggle";

afterEach(cleanup);

test("the stepper screens initial backing before walking through the filtered tally", () => {
  render(<Stepper />);
  expect(screen.getByText(/Step 1 of 11/)).toBeTruthy();
  expect(screen.getByText("Excluded: $15,000 initial backing is below the ask")).toBeTruthy();
  expect(screen.getByText("Excluded: $10,000 initial backing is below the ask")).toBeTruthy();
  const reset = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(screen.getByText(/Bridge fuzzing harness costs \$40,000/)).toBeTruthy();
  expect(screen.getByText(/Audit firms \$21,818 and Solo auditors \$18,182/)).toBeTruthy();
  const next = screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
  let widened = false;
  while (!next.disabled) {
    fireEvent.click(next);
    widened ||= screen.queryByText(/The tally widens to each voter's top 2 choices/) !== null;
  }
  expect(widened).toBe(true);
  expect(screen.getByText(/\$5,000 is left and no unfunded eligible proposal costs that little/)).toBeTruthy();
  expect(screen.getByText("$95,000 of $100,000 spent")).toBeTruthy();
  expect(screen.getByText(/Step 11 of 11/)).toBeTruthy();
  fireEvent.click(reset);
  expect(screen.getByText(/Step 1 of 11/)).toBeTruthy();
  expect(reset.disabled).toBe(true);
});

test("a ballot for the war room funds it and spends the whole seat there", () => {
  render(<Playground />);
  expect(screen.getByText(/your seat changes nothing/)).toBeTruthy();
  const excluded = within(screen.getByRole("list", { name: "Excluded proposals" }));
  expect(excluded.getByText(/Incident war room: \$15,000 backing \/ \$20,000 ask/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back the war room" }));
  expect(excluded.queryByText(/Incident war room:/)).toBeNull();
  expect(screen.getByText(/Funded because of you: Incident war room\./)).toBeTruthy();
  expect(screen.getByText(/\$5,000 to Incident war room/)).toBeTruthy();
  const must = screen.getByRole("rowheader", { name: "Must fund" }).closest("tr")!;
  expect(within(must).getByRole("button", { name: /Incident war room/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(within(screen.getByRole("list", { name: "Excluded proposals" })).getByText(/Incident war room:/)).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Funded proposals" })).queryByText("Incident war room")).toBeNull();
});

test("a public donation lowers the ask so both minority first choices pass", () => {
  render(<Playground />);
  fireEvent.change(screen.getByLabelText(/Add a public donation/), { target: { value: "6" } });
  expect(within(screen.getByRole("list", { name: "Excluded proposals" })).queryByText(/Incident war room:/)).toBeNull();
  expect(screen.getByText(/Incident war room now asks the pool for \$15,000 instead of \$20,000/)).toBeTruthy();
  const funded = within(screen.getByRole("list", { name: "Funded proposals" }));
  expect(funded.getByText("Incident war room")).toBeTruthy();
  expect(screen.getByText(/The \$5,000 donation is what got Incident war room funded/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back the course" }));
  expect(funded.getByText("Incident war room")).toBeTruthy();
  expect(funded.getByText("Formal verification course")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Incident war room \(\$15k\)/ })).toBeTruthy();
});

test("the theme toggle sets and remembers the theme", () => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  cleanup();
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Dark theme" })).toBeTruthy();
});
