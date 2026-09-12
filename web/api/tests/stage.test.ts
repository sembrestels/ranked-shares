import { assertEquals } from "@std/assert";
import { type StageFacts, stageOf } from "../services/stage.ts";

const base: StageFacts = {
  kind: "zisk",
  phase: "open",
  votingDeadline: 2_000,
  finality: null,
  spent: "0",
  claimedTotal: "0",
};
const states = (s: ReturnType<typeof stageOf>) => s.steps.map((x) => x.state).join(" ");
const labels = (s: ReturnType<typeof stageOf>) => s.steps.map((x) => x.label).join(" ");

Deno.test("stage: seven steps in order with the spec's labels", () => {
  const s = stageOf(base, 1_000);
  assertEquals(s.steps.map((x) => x.key), [
    "proposals",
    "setup",
    "open",
    "closing",
    "proving",
    "proven",
    "paid",
  ]);
  assertEquals(labels(s), "Proposals Setup Open Closing Proving Proven Paid");
});

Deno.test("stage: setup marks proposals and setup current", () => {
  const s = stageOf({ ...base, phase: "setup" }, 1_000);
  assertEquals(s.current, "setup");
  assertEquals(states(s), "current current next next next next next");
});

Deno.test("stage: open before the deadline", () => {
  const s = stageOf(base, 1_000);
  assertEquals(s.current, "open");
  assertEquals(states(s), "done done current next next next next");
});

Deno.test("stage: a plain pool past the deadline but not tallying is closing", () => {
  const s = stageOf({ ...base, kind: "plain" }, 2_500);
  assertEquals(s.current, "closing");
});

Deno.test("stage: closing and tally", () => {
  assertEquals(stageOf({ ...base, phase: "closing" }, 2_500).current, "closing");
  const t = stageOf({ ...base, phase: "tally" }, 2_500);
  assertEquals(t.current, "proving");
  assertEquals(states(t), "done done done done current next next");
});

Deno.test("stage: plain pool labels proving as Counting and finality as Counted", () => {
  const s = stageOf({ ...base, kind: "plain", phase: "tally" }, 2_500);
  assertEquals(s.steps[4].label, "Counting");
  assertEquals(s.steps[5].label, "Counted");
});

Deno.test("stage: done with unpaid funded projects stays on proven, labelled by finality", () => {
  const s = stageOf({
    ...base,
    phase: "done",
    finality: "proven",
    spent: "100",
    claimedTotal: "40",
  }, 3_000);
  assertEquals(s.current, "proven");
  assertEquals(s.steps[5].label, "Proven");
  assertEquals(states(s), "done done done done done current next");
  assertEquals(
    stageOf({ ...base, phase: "done", finality: "attested", spent: "1", claimedTotal: "0" }, 3_000)
      .steps[5].label,
    "Provisional",
  );
});

Deno.test("stage: done and fully paid moves to paid", () => {
  const s = stageOf({
    ...base,
    phase: "done",
    finality: "proven",
    spent: "100",
    claimedTotal: "100",
  }, 3_000);
  assertEquals(s.current, "paid");
  assertEquals(states(s), "done done done done done done current");
});

Deno.test("stage: abandoned ends on proven labelled Abandoned with paid next", () => {
  const s = stageOf({
    ...base,
    phase: "done",
    finality: "abandoned",
    spent: "0",
    claimedTotal: "0",
  }, 3_000);
  assertEquals(s.current, "proven");
  assertEquals(s.steps[5].label, "Abandoned");
  assertEquals(s.steps[6].state, "next");
});
