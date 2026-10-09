import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "../app/components/onepager/stepper";
import { Playground } from "../app/components/onepager/playground";
import { LEAD, QuietEnding } from "../app/components/onepager/quiet-ending";
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

test("a slow quiet ending is read by scrolling: each tier is settled by a quiet window that ends as it began, then presented", async () => {
  const { container } = render(<QuietEnding />);
  // Every moment's text is in the box at the bottom; only the current one shows.
  const current = () => container.querySelector<HTMLElement>(".op-quiet-step[data-current]")!;
  const narration = () => current().querySelector(".op-quiet-text")!.textContent!;
  const when = () => current().querySelector(".op-quiet-when")!.textContent!;
  const chart = () => screen.getByRole("img").getAttribute("aria-label")!;
  // Scroll until the chart is drawn down to an hour after the first tally: ten pixels
  // an hour, with the text that stays at the bottom at the top of the screen.
  const plot = container.querySelector(".op-fate-plot")!;
  const scrollTo = async (hour: number) => {
    plot.getBoundingClientRect = () => ({ top: -LEAD - hour * 10, height: 2160 }) as DOMRect;
    await act(async () => {
      fireEvent.scroll(window);
      await new Promise((done) => requestAnimationFrame(done));
    });
  };
  // The first place a label appears on the chart: every tier has the same quiet windows.
  const ahead = (text: string) => within(container.querySelector<HTMLElement>(".op-fate")!).getAllByText(text)[0].closest("[data-ahead]") !== null;
  // The box at the bottom waits until the chart reaches the place where its lines are drawn.
  const waiting = () => container.querySelector(".op-quiet-panel")!.hasAttribute("data-waiting");
  expect(waiting()).toBe(true);
  await scrollTo(-5);
  expect(waiting()).toBe(true);
  await scrollTo(0);
  expect(waiting()).toBe(false);
  expect(container.querySelectorAll(".op-quiet-step[data-current]")).toHaveLength(1);
  expect(when()).toMatch(/December 1/);
  // Only the S-Tier has a tally so far, and nothing below the first line is drawn.
  expect(narration()).toMatch(/Bridge fuzzing harness and Phishing blocklist API would be funded from it/);
  expect(chart()).toMatch(/funded: Bridge fuzzing harness, Phishing blocklist API\. Not funded: /);
  expect(ahead("Dec 1")).toBe(false);
  expect(ahead("Dec 2")).toBe(true);
  expect(ahead("A late ballot")).toBe(true);
  await scrollTo(14);
  expect(ahead("A late ballot")).toBe(true);
  await scrollTo(15);
  expect(when()).toMatch(/December 1, the afternoon/);
  // One more ballot shrinks every share: the blocklist the wallet teams could exactly afford
  // drops out, and the late voter's own first choice is just as short.
  expect(ahead("A late ballot")).toBe(false);
  expect(narration()).toMatch(/every share shrinks from \$5,000 to \$4,761/);
  expect(narration()).toMatch(/Now they hold \$19,044 and it drops out, \$956 short/);
  expect(narration()).toMatch(/its backers hold \$19,044 for a \$20,000 ask/);
  expect(chart()).toMatch(/funded: Bridge fuzzing harness\. Not funded: /);
  await scrollTo(24);
  expect(when()).toMatch(/December 2, the deadline/);
  expect(ahead("Dec 2")).toBe(false);
  expect(ahead("12h")).toBe(false);
  expect(ahead("6h")).toBe(true);
  expect(within(current()).getByText("Changed: a new quiet window, half as long")).toBeTruthy();
  await scrollTo(30);
  // The donation rescues the blocklist; nobody rescues the war room.
  expect(narration()).toMatch(/A donor gives \$1,000 to the blocklist, which now asks the pool for \$19,000/);
  expect(chart()).toMatch(/funded: Bridge fuzzing harness, Phishing blocklist API\. Not funded: /);
  await scrollTo(36);
  expect(when()).toMatch(/December 2, midday/);
  expect(narration()).toMatch(/The 12-hour quiet window ends, and the result changed again/);
  // The third quiet window ends as it began: the tier is settled, a day before it is presented.
  const shaded = () => container.querySelectorAll(".op-fate-spans [data-shaded]").length;
  await scrollTo(41);
  expect(shaded()).toBe(0);
  // The window that settles the tier is only coloured once the lines have passed it.
  await scrollTo(42);
  expect(shaded()).toBe(1);
  expect(when()).toMatch(/December 2, the evening/);
  expect(within(current()).getByText("Unchanged: the S-Tier is settled")).toBeTruthy();
  expect(narration()).toMatch(/the S-Tier is settled: Bridge fuzzing harness and Phishing blocklist API are funded/);
  // The quiet windows that are not needed pass without anything happening.
  await scrollTo(47);
  expect(when()).toMatch(/December 2, the evening/);
  await scrollTo(48);
  expect(when()).toMatch(/December 3.*S-Tier winners presented/);
  await scrollTo(96);
  // The A-Tier's two days start with its first tally, paid for with what the S-Tier left.
  expect(when()).toMatch(/December 5/);
  expect(narration()).toMatch(/Whitehat legal retainer and Audit findings database would be funded from it/);
  // What moves the lines is said beside the moment.
  expect(ahead("The money the S-Tier left pays for the retainer and the findings database.")).toBe(false);
  await scrollTo(120);
  expect(when()).toMatch(/December 6.*A-Tier settled/);
  expect(within(current()).getByText("Unchanged: the A-Tier is settled")).toBeTruthy();
  await scrollTo(144);
  expect(when()).toMatch(/December 7.*A-Tier winners presented/);
  expect(chart()).toMatch(/Not funded: .*Transaction simulation warnings.*Incident war room/);
  await scrollTo(168);
  // The B-Tier's first tally funds nothing; the late voter then adds the proposal that
  // was just short, which changes the result inside the quiet window.
  expect(when()).toMatch(/December 8.*First B-Tier tally/);
  expect(narration()).toMatch(/Nothing would be funded from it: Transaction simulation warnings comes closest, \$158 short/);
  expect(chart()).toMatch(/Not funded: .*Transaction simulation warnings/);
  await scrollTo(183);
  expect(when()).toMatch(/December 8, the afternoon.*A ballot is changed/);
  expect(narration()).toMatch(/The late voter still holds \$3,096, more than the \$158 missing/);
  expect(chart()).toMatch(/funded: .*Transaction simulation warnings.*\. Not funded: .*Incident war room/);
  await scrollTo(192);
  expect(when()).toMatch(/December 9.*Not the same result/);
  expect(within(current()).getByText("Changed: a new quiet window, half as long")).toBeTruthy();
  await scrollTo(204);
  expect(when()).toMatch(/December 9, midday.*B-Tier settled/);
  expect(narration()).toMatch(/the B-Tier is settled: Transaction simulation warnings is funded/);
  await scrollTo(216);
  expect(when()).toMatch(/December 10.*B-Tier winners presented/);
  expect(within(current()).getByText("The round is settled")).toBeTruthy();
  // A little further down, the result as a whole, tier by tier.
  await scrollTo(400);
  expect(when()).toMatch(/The final result/);
  const result = within(current());
  const tier = (label: string) => result.getByText(label).nextElementSibling!.textContent;
  expect(tier("S-Tier")).toBe("Bridge fuzzing harnessPhishing blocklist API");
  expect(tier("A-Tier")).toBe("Whitehat legal retainerAudit findings database");
  expect(tier("B-Tier")).toBe("Transaction simulation warnings");
  expect(tier("Back to TheDAO")).toBe("$4,000");
  // Scrolling back up goes back in time.
  await scrollTo(24);
  expect(when()).toMatch(/December 2, the deadline/);
  expect(ahead("Dec 3")).toBe(true);
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
