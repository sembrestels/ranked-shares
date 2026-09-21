import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TierList } from "../app/components/voting/tier-list";
import { BallotForm } from "../app/components/voting";
import { type FundingTier, type TierAssignments } from "../app/lib/ballot-tiers";

afterEach(cleanup);
const titles = ["Community garden", "Library", "Cycle route"];

function Draft({ names = titles, disabled = false, onAssign = () => {} }: {
  names?: string[];
  disabled?: boolean;
  onAssign?: (id: number, tier: FundingTier | undefined) => void;
}) {
  const [assignments, setAssignments] = useState<TierAssignments>({});
  return <TierList titles={names} assignments={assignments} disabled={disabled} onAssign={(id, tier) => {
    onAssign(id, tier);
    setAssignments((previous) => ({ ...previous, [id]: tier }));
  }} />;
}

function destination(label: string) {
  return label === "Unplaced proposals"
    ? screen.getByRole("region", { name: /^Unplaced proposals/ })
    : screen.getByRole("rowheader", { name: new RegExp(`${label}$`) }).closest("tr")!;
}

function move(title: string, label: string) {
  fireEvent.click(screen.getByRole("button", { name: title }));
  fireEvent.click(screen.getByRole("button", { name: `Move here: ${label}` }));
}

function drag(title: string, label: string) {
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(screen.getByRole("button", { name: title }), { dataTransfer });
  fireEvent.dragOver(destination(label), { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("move");
  expect(destination(label).getAttribute("data-drag-over")).toBe("true");
  fireEvent.drop(destination(label), { dataTransfer });
}

test("starts with every proposal unplaced and exactly three empty tier rows", () => {
  render(<Draft />);
  expect(screen.getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["S-TierMust fund", "A-TierShould fund", "B-TierNice to have"]);
  expect(within(destination("Unplaced proposals")).getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getAllByText("Drop proposals here")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /Move here/ })).toBeNull();
});

test("select-to-move reaches every group and preserves focus without duplicates", () => {
  render(<Draft />);
  for (const label of ["Must fund", "Should fund", "Nice to have", "Unplaced proposals"]) {
    move("Community garden", label);
    const card = within(destination(label)).getByRole("button", { name: "Community garden" });
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe(`Community garden moved to ${label}.`);
    expect(screen.getAllByRole("button", { name: "Community garden" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Move here/ })).toBeNull();
  }
});

test("native drag moves proposals between every group, including empty destinations", () => {
  const assigned = vi.fn();
  render(<Draft onAssign={assigned} />);
  for (const label of ["Must fund", "Should fund", "Nice to have", "Unplaced proposals"]) {
    drag("Library", label);
    expect(within(destination(label)).getByRole("button", { name: "Library" })).toBe(document.activeElement);
  }
  expect(assigned.mock.calls).toEqual([[1, "must"], [1, "should"], [1, "nice"], [1, undefined]]);
  const before = assigned.mock.calls.length;
  drag("Library", "Unplaced proposals");
  expect(assigned).toHaveBeenCalledTimes(before);
  expect(screen.getByRole("status").textContent).toBe("Library is already in Unplaced proposals.");
});

test("tier boxes stay in project-ID order regardless of insertion order", () => {
  render(<Draft />);
  move("Cycle route", "Must fund");
  move("Community garden", "Must fund");
  move("Library", "Must fund");
  expect(within(destination("Must fund")).getAllByRole("button").map((b) => b.textContent?.slice(1))).toEqual(titles);
  expect(screen.getByText("All proposals placed")).toBeTruthy();
});

test("Escape, selecting again, and a cancelled drag leave the assignment unchanged", () => {
  const assigned = vi.fn();
  render(<Draft onAssign={assigned} />);
  const card = screen.getByRole("button", { name: "Library" });
  fireEvent.click(card);
  expect(card.getAttribute("aria-pressed")).toBe("true");
  const moveButton = screen.getByRole("button", { name: "Move here: Must fund" });
  moveButton.focus();
  fireEvent.keyDown(moveButton, { key: "Escape" });
  expect(document.activeElement).toBe(card);
  expect(card.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("status").textContent).toContain("Move cancelled");
  fireEvent.click(card);
  fireEvent.click(card);
  expect(card.getAttribute("aria-pressed")).toBe("false");
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
  fireEvent.dragEnd(card);
  expect(screen.queryByRole("button", { name: /Move here/ })).toBeNull();
  expect(assigned).not.toHaveBeenCalled();
});

test("external and repeated drops cannot add or duplicate proposals", () => {
  const assigned = vi.fn();
  render(<Draft onAssign={assigned} />);
  const dataTransfer = { getData: () => "1", setData: vi.fn() };
  fireEvent.drop(destination("Must fund"), { dataTransfer });
  expect(assigned).not.toHaveBeenCalled();
  drag("Library", "Must fund");
  fireEvent.drop(destination("Nice to have"), { dataTransfer });
  expect(assigned).toHaveBeenCalledTimes(1);
  expect(within(destination("Must fund")).getAllByRole("button", { name: "Library" })).toHaveLength(1);
});

test("busy state cancels selection and blocks click and drag movement", () => {
  const assigned = vi.fn();
  const view = render(<Draft onAssign={assigned} />);
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  view.rerender(<Draft disabled onAssign={assigned} />);
  const card = screen.getByRole("button", { name: "Library" }) as HTMLButtonElement;
  expect(card.disabled).toBe(true);
  expect(card.draggable).toBe(false);
  expect(card.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("button", { name: /Move here/ })).toBeNull();
  fireEvent.click(card);
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
  fireEvent.drop(destination("Must fund"));
  expect(assigned).not.toHaveBeenCalled();
});

test("loaded and duplicate titles preserve project identity and render only text", () => {
  const view = render(<Draft />);
  move("Library", "Should fund");
  const title = '<img src=x onerror="alert(1)"> A very long proposal title for a shared community space';
  view.rerender(<Draft names={[title, title, title]} />);
  expect(within(destination("Should fund")).getByRole("button", { name: title }).getAttribute("data-proposal-id")).toBe("1");
  expect(screen.getAllByRole("button", { name: title })).toHaveLength(3);
  expect(view.container.querySelector("img,script")).toBeNull();
});

test("the ballot form preserves tiers when changing mode and permits all-unplaced ballots", () => {
  const submit = vi.fn();
  const props = { titles, assignments: {}, canPublic: true, canSealed: true, busy: false, onAssign: vi.fn(), onMode: vi.fn(), onSubmit: submit };
  const view = render(<BallotForm {...props} sealed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Vote" }));
  expect(submit).toHaveBeenCalledTimes(1);
  view.rerender(<BallotForm {...props} assignments={{ 1: "must" }} sealed />);
  expect(within(destination("Must fund")).getByRole("button", { name: "Library" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Vote" }));
  expect(submit).toHaveBeenCalledTimes(2);
  for (const overrides of [{ busy: true }, { canSealed: false }]) {
    view.rerender(<BallotForm {...props} {...overrides} sealed />);
    const button = screen.getByRole("button", { name: "Vote" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.submit(button.closest("form")!);
  }
  expect(submit).toHaveBeenCalledTimes(2);
});
