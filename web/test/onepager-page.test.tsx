import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "../app/components/onepager/stepper";
import { Playground } from "../app/components/onepager/playground";
import { QuietEnding } from "../app/components/onepager/quiet-ending";
import { ThemeToggle } from "../app/components/onepager/theme-toggle";

afterEach(cleanup);

test("the stepper walks through the tally and returns what is left", () => {
  const { container } = render(<Stepper />);
  // Every step's text is in the page to hold the box's height; only the current one shows.
  const narration = () => container.querySelector(".op-narration [data-current]")!.textContent!;
  expect(container.querySelectorAll(".op-narration p")).toHaveLength(10);
  expect(container.querySelectorAll(".op-narration p:not([aria-hidden])")).toHaveLength(1);
  expect(screen.getByText(/Step 1 of 10/)).toBeTruthy();
  expect(narration()).toMatch(/split equally among the 20 badge holders who submitted a ballot, \$5,000 each/);
  expect(screen.queryByText(/[Ee]xcluded/)).toBeNull();
  expect(screen.getByText("No tier counted yet.")).toBeTruthy();
  const reset = screen.getByRole("button", { name: "Start over" }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(narration()).toMatch(/Bridge fuzzing harness costs \$40,000/);
  expect(narration()).toMatch(/Audit firms \$21,818 and Solo auditors \$18,182/);
  const next = screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
  let widened = false;
  let lastTier = false;
  let firstTier = false;
  while (!next.disabled) {
    fireEvent.click(next);
    if (/the S-Tier is settled: Bridge fuzzing harness and Phishing blocklist API are funded from it\. A round that announces its results tier by tier makes an announcement here/.test(narration())) {
      firstTier = true;
      expect(screen.getByText("S-Tier settled. Counting the A-Tier.")).toBeTruthy();
    }
    widened ||= /the tally widens a step\. Audit firms, Solo auditors, Wallet teams, Incident responders and Researchers open their A-Tier\./.test(narration());
    lastTier ||= /Incident responders \$8,873 and Researchers \$1,127/.test(narration());
  }
  expect(widened).toBe(true);
  expect(lastTier).toBe(true);
  expect(firstTier).toBe(true);
  expect(screen.getByText("S-Tier, A-Tier and B-Tier settled.")).toBeTruthy();
  expect(narration()).toMatch(/That settles the B-Tier: Transaction simulation warnings is funded from it/);
  expect(narration()).toMatch(/The \$3,000 they still hold goes back to TheDAO/);
  expect(screen.getByText("$97,000 of $100,000 spent")).toBeTruthy();
  expect(screen.getAllByText("Return to TheDAO")).toHaveLength(5);
  expect(screen.getByText(/Step 10 of 10/)).toBeTruthy();
  fireEvent.click(reset);
  expect(screen.getByText(/Step 1 of 10/)).toBeTruthy();
  expect(reset.disabled).toBe(true);
});

test("a quiet ending follows a late ballot, an extension and a donation until two results agree", () => {
  const { container } = render(<QuietEnding />);
  const narration = () => container.querySelector(".op-narration [data-current]")!.textContent!;
  const chart = () => screen.getByRole("img").getAttribute("aria-label")!;
  const next = screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
  expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
  expect(screen.getByText("20 ballots, $5,000 each")).toBeTruthy();
  expect(chart()).toMatch(/funded: .*Phishing blocklist API.*\. Not funded: .*Incident war room/);
  fireEvent.click(next);
  // One more ballot shrinks every share: the blocklist the wallet teams could exactly afford
  // drops out, and the late voter's own first choice is just as short.
  expect(narration()).toMatch(/every share shrinks from \$5,000 to \$4,761/);
  expect(narration()).toMatch(/Now they hold \$19,044 and it drops out, \$956 short/);
  expect(narration()).toMatch(/its backers hold \$19,044 for a \$20,000 ask/);
  expect(screen.getByText("21 ballots, $4,761 each")).toBeTruthy();
  expect(chart()).toMatch(/Not funded: .*Phishing blocklist API.*Incident war room/);
  fireEvent.click(next);
  expect(screen.getByText("Changed: voting is extended")).toBeTruthy();
  fireEvent.click(next);
  // The donation rescues the war room; nobody rescues the blocklist.
  expect(narration()).toMatch(/A donor gives \$1,000 to the war room, which now asks the pool for \$19,000/);
  expect(chart()).toMatch(/funded: .*Incident war room.*\. Not funded: .*Phishing blocklist API/);
  fireEvent.click(next);
  expect(screen.getByText("Changed: extended again, half as long")).toBeTruthy();
  // The last rule is only named once the round is known to end there.
  expect(screen.getByText("Finally settled").hasAttribute("data-hidden")).toBe(true);
  fireEvent.click(next);
  expect(screen.getByText("Finally settled").hasAttribute("data-hidden")).toBe(false);
  expect(next.disabled).toBe(true);
  expect(screen.getByText("Unchanged: the round is settled")).toBeTruthy();
  expect(narration()).toMatch(/Incident war room.* are funded, and the \$4,000 left goes back to TheDAO/);
  // The timeline jumps to any moment.
  fireEvent.click(screen.getByRole("button", { name: /The deadline/ }));
  expect(screen.getByText(/Step 3 of 6/)).toBeTruthy();
});

test("a ballot for the war room funds it and spends the whole seat there", () => {
  render(<Playground />);
  expect(screen.getByText(/so you change nothing/)).toBeTruthy();
  expect(screen.getByText("$100,000 pool, 20 ballots, $5,000 each")).toBeTruthy();
  const funded = within(screen.getByRole("list", { name: "Funded proposals" }));
  expect(funded.queryByText("Incident war room")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back the war room" }));
  expect(funded.getByText("Incident war room")).toBeTruthy();
  expect(screen.getByText("$105,000 pool, 20 ballots plus yours, $5,000 each")).toBeTruthy();
  expect(screen.getByText(/Funded because of you: Incident war room\./)).toBeTruthy();
  expect(screen.getByText(/\$5,000 to Incident war room/)).toBeTruthy();
  const must = screen.getByRole("rowheader", { name: /^S-Tier\s*Must fund$/ }).closest("tr")!;
  expect(within(must).getByRole("button", { name: /Incident war room/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(within(screen.getByRole("list", { name: "Funded proposals" })).queryByText("Incident war room")).toBeNull();
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
