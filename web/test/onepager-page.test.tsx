import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "../app/components/onepager/stepper";
import { Playground } from "../app/components/onepager/playground";
import { ThemeToggle } from "../app/components/onepager/theme-toggle";

afterEach(cleanup);

test("the stepper walks from first choices to the closing frame", () => {
  render(<Stepper />);
  expect(screen.getByText(/Step 1 of 10/)).toBeTruthy();
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
  expect(screen.getByText(/\$5,000 is left and no open proposal costs that little/)).toBeTruthy();
  expect(screen.getByText("$95,000 of $100,000 spent")).toBeTruthy();
  expect(screen.getByText(/Step 10 of 10/)).toBeTruthy();
  fireEvent.click(reset);
  expect(screen.getByText(/Step 1 of 10/)).toBeTruthy();
  expect(reset.disabled).toBe(true);
});

test("a ballot for the war room funds it and spends the whole seat there", () => {
  render(<Playground />);
  expect(screen.getByText(/your seat changes nothing/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back the war room" }));
  expect(screen.getByText(/Funded because of you: Incident war room\./)).toBeTruthy();
  expect(screen.getByText(/\$5,000 to Incident war room/)).toBeTruthy();
  const must = screen.getByRole("rowheader", { name: "Must fund" }).closest("tr")!;
  expect(within(must).getByRole("button", { name: /Incident war room/ })).toBeTruthy();
});

test("a public donation lowers the ask so both minority first choices pass", () => {
  render(<Playground />);
  fireEvent.change(screen.getByLabelText(/Add a public donation/), { target: { value: "6" } });
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
