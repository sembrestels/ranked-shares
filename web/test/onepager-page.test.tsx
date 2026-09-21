import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "../app/components/onepager/stepper";
import { Playground } from "../app/components/onepager/playground";

afterEach(cleanup);

test("the stepper walks from first choices to the closing frame", () => {
  render(<Stepper />);
  expect(screen.getByText(/Step 0 of/)).toBeTruthy();
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

test("open money lets both minority first choices through", () => {
  render(<Playground />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Back the war room" }));
  const funded = within(screen.getByRole("list", { name: "Funded proposals" }));
  expect(funded.getByText("Incident war room")).toBeTruthy();
  expect(funded.getByText("Formal verification course")).toBeTruthy();
});
