# Round pages B: the SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The round page at `/`, the project page at `/project/:id`, the stage bar on every route, and the app shell in the Blossom brand look, reading from the API of plan A; the proposals board moves to `/proposals`.

**Architecture:** Presentational components (atoms, molecules, organisms per `docs/design/design-system.md`) receive data through props; route containers and hooks fetch from the API with TanStack Query and refetch after the user's own transaction by passing the receipt's block as `after`. Tailwind v4 utilities over the tokens in `app/tokens.css`; the old class names stay only on untouched screens. Fixed routes and known project pages are prerendered with build-time loaders so shared links unfurl.

**Tech Stack:** React 19, React Router 7 (`ssr: false` + prerender), TanStack Query, wagmi + viem, Tailwind v4, vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-12-round-pages-design.md` (sections 2, 4, 5). Stories: `docs/design/stories/05-follow-the-round.md`, `06-close-and-prove.md`, `01-propose-a-project.md` (S1.1, S1.8).

## Global Constraints

- All files under `web/`; run commands from `web/`. Tests: `deno task test` (vitest). Type check: `deno task typecheck`. Build: `deno task build`.
- Components under `app/components/` are presentational: data in via props, events out via callbacks, no fetching, no wagmi hooks. Route files under `app/routes/` and hooks under `app/hooks/` do the fetching.
- No raw colours, spacing, or font names in components: Tailwind utilities backed by the tokens (`bg-page`, `bg-surface`, `bg-sunken`, `bg-inverse`, `text-primary`, `text-secondary`, `text-on-inverse`, `border-edge`, `border-edge-strong`, `bg-accent`, `text-accent`, `border-signal`, `text-signal-text`, `text-success`, `bg-info-bg`, `text-error`, `bg-error-bg`, `font-heading`, `font-mono`) or `var(--…)` from `app/tokens.css`.
- Copy verbatim from the spec (section 2, decision 11) and the stories: "Your ballot: not cast. Money without a ballot funds nothing.", "No pitch was published for this project", "The pitch could not be loaded; try again", "check this result yourself", "Waiting for the first proof", "Close next batch", the three finality sentences and the Counted sentence. Sentence case everywhere; no all-caps labels; no arrows or em-dashes in copy.
- Money is shown in the token's units with the symbol after the number, at most two decimals shown, the full value in a `title`. Times are shown in the viewer's local time zone with an ISO `dateTime` attribute.
- Never render proposal content as HTML: text nodes only, attachments downloaded as binary.
- S5.8 ("Rank this project") is out of scope: no `/vote` route exists yet; the project page has no rank control in this slice.
- Commits: one per task, imperative message, no attribution lines.

---

### Task 1: API client, types, hooks, and the after-transaction signal

**Files:**
- Create: `web/app/lib/api-types.ts`, `web/app/lib/api.ts`, `web/app/hooks/use-snapshot.ts`, `web/app/hooks/use-now.ts`
- Modify: `web/app/context/providers.tsx` (round context gains `after` and `markMined`)
- Test: `web/test/api.test.ts`, `web/test/snapshot-hooks.test.tsx`

**Interfaces:**
- Produces: types `RoundSnapshot`, `SnapshotProject`, `ProjectResponse`, `VoterResponse`, `Stage`, `StepKey`, `Finality`, `Kind` (mirroring the API of plan A); `fetchRound(pool?, after?, fetchFn?)`, `fetchProject(id, pool?, after?, fetchFn?)`, `fetchVoter(address, pool?, after?, fetchFn?)`, `ApiError(status, message)`; hooks `useRoundSnapshot()`, `useProject(id)`, `useVoter()`, `useNow(intervalMs)`; round context `{ pool, setPool, after, markMined(block) }`.

- [ ] **Step 1: Write `web/app/lib/api-types.ts`**

```ts
/** Shapes served by web/api (plan A). Bigints travel as decimal strings. */
export type Kind = "plain" | "cre" | "zisk" | "noir";
export type PhaseName = "setup" | "open" | "closing" | "tally" | "done";
export type Finality = "proven" | "attested" | "abandoned" | "counted";
export type StepKey = "proposals" | "setup" | "open" | "closing" | "proving" | "proven" | "paid";
export type StepState = "done" | "current" | "next";

export interface SnapshotProject {
  id: number;
  cost: string;
  recipient: `0x${string}`;
  contentRef: `0x${string}`;
  commitment: string;
  funded: boolean;
  claimed: boolean;
  title: string | null;
}
export interface Stage {
  current: StepKey;
  steps: { key: StepKey; state: StepState; label: string }[];
}
export interface RoundSnapshot {
  pool: `0x${string}`;
  kind: Kind;
  chainId: number;
  block: number;
  at: number;
  token: { address: `0x${string}`; symbol: string; decimals: number };
  phase: PhaseName;
  votingDeadline: number;
  totalWeight: string;
  spent: string;
  claimedTotal: string;
  projects: SnapshotProject[];
  fundedOrder: number[];
  proposalCount: number;
  voterCount: number;
  sealed: { total: string; count: number; commitmentsAvailable: boolean };
  closing: { closed: boolean; cursor: number } | null;
  proving: { accepted: number; total: number | null } | null;
  finality: Finality | null;
  graces: { abandonFrom: number | null; provisionalFrom: number | null };
  stage: Stage;
}
export interface Attachment {
  reference: string;
  name: string;
  type: string;
  size: number;
}
export interface ProposalContent {
  version: number;
  title: string;
  body: string;
  attachments: Attachment[];
}
export interface ProjectResponse {
  project: SnapshotProject;
  round: Pick<RoundSnapshot, "pool" | "kind" | "block" | "at" | "token" | "phase" | "finality" | "stage">;
  contentStatus: "ok" | "none" | "unavailable";
  content: ProposalContent | null;
  reason: string | null;
}
export interface VoterResponse {
  address: `0x${string}`;
  block: number;
  weight: { direct: string; seats: string; total: string };
  ballot: { public: { ranks: number[] } | null; sealed: boolean };
  inRoster: boolean;
}
```

- [ ] **Step 2: Write the failing client tests `web/test/api.test.ts`**

```ts
import { expect, test, vi } from "vitest";
import { ApiError, fetchProject, fetchRound, fetchVoter } from "../app/lib/api";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

test("fetchRound builds the query string and returns the body", async () => {
  const f = vi.fn(async () => ok({ block: 7 }));
  const out = await fetchRound("0xabc", 12, f as unknown as typeof fetch);
  expect(f).toHaveBeenCalledWith("/api/round?pool=0xabc&after=12");
  expect(out).toEqual({ block: 7 });
});

test("fetchProject and fetchVoter omit unset parameters", async () => {
  const f = vi.fn(async () => ok({}));
  await fetchProject(3, undefined, undefined, f as unknown as typeof fetch);
  await fetchVoter("0xdef", "0xabc", 5, f as unknown as typeof fetch);
  expect(f.mock.calls.map((c) => c[0])).toEqual(["/api/project/3", "/api/voter/0xdef?pool=0xabc&after=5"]);
});

test("errors carry the API's message and status", async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ error: "rpc unavailable" }), { status: 502 }));
  await expect(fetchRound(undefined, undefined, f as unknown as typeof fetch)).rejects.toMatchObject({
    name: "ApiError",
    status: 502,
    message: "rpc unavailable",
  });
  const g = vi.fn(async () => new Response("<html>", { status: 500 }));
  await expect(fetchRound(undefined, undefined, g as unknown as typeof fetch)).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 3: Run to see them fail**

Run: `deno task test -- test/api.test.ts` (or `deno run -A npm:vitest run test/api.test.ts`)
Expected: FAIL, module `../app/lib/api` not found.

- [ ] **Step 4: Write `web/app/lib/api.ts`**

```ts
/** The read API client. Same origin by default; VITE_API_URL points a build at a remote API. */
import type { ProjectResponse, RoundSnapshot, VoterResponse } from "./api-types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const base = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

function url(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return `${base}${path}${s ? `?${s}` : ""}`;
}

async function getJson<T>(
  path: string,
  params: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchFn(url(path, params));
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const afterParam = (after?: number) => (after === undefined ? undefined : String(after));

export const fetchRound = (pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<RoundSnapshot>("/api/round", { pool, after: afterParam(after) }, fetchFn);
export const fetchProject = (id: number, pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<ProjectResponse>(`/api/project/${id}`, { pool, after: afterParam(after) }, fetchFn);
export const fetchVoter = (address: string, pool?: string, after?: number, fetchFn?: typeof fetch) =>
  getJson<VoterResponse>(`/api/voter/${address}`, { pool, after: afterParam(after) }, fetchFn);
```

- [ ] **Step 5: Run the client tests**

Run: `deno run -A npm:vitest run test/api.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Extend the round context in `web/app/context/providers.tsx`**

Change the context type and provider:

```ts
type RoundContext = {
  pool?: Address;
  setPool: (pool: Address) => void;
  /** Block number of the user's last mined transaction; the API re-reads past it. */
  after?: number;
  markMined: (block: number) => void;
};
const Round = createContext<RoundContext>({ setPool: () => {}, markMined: () => {} });
```

inside `Providers` add `const [after, setAfter] = useState<number>();` and
`const markMined = (block: number) => setAfter((prev) => (prev === undefined || block > prev ? block : prev));`
and pass `value={{ pool, setPool: selectPool, after, markMined }}`.

- [ ] **Step 7: Write `web/app/hooks/use-now.ts` and `web/app/hooks/use-snapshot.ts`**

`use-now.ts`:

```ts
import { useEffect, useState } from "react";

/** Unix seconds, re-rendered every intervalMs so countdowns and "updated ago" move. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

`use-snapshot.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useRound } from "../context/providers";
import { fetchProject, fetchRound, fetchVoter } from "../lib/api";

export const POLL_MS = 15_000;

export function useRoundSnapshot() {
  const { pool, after } = useRound();
  return useQuery({
    queryKey: ["round", pool ?? "", after ?? 0],
    queryFn: () => fetchRound(pool, after),
    enabled: !!pool,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: number) {
  const { pool, after } = useRound();
  return useQuery({
    queryKey: ["project", pool ?? "", id, after ?? 0],
    queryFn: () => fetchProject(id, pool, after),
    enabled: !!pool && Number.isInteger(id) && id >= 0,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useVoter() {
  const { pool, after } = useRound();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["voter", pool ?? "", address ?? "", after ?? 0],
    queryFn: () => fetchVoter(address as string, pool, after),
    enabled: !!pool && !!address,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 8: Write the failing hook test `web/test/snapshot-hooks.test.tsx`**

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ after: undefined as number | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }) }));
vi.mock("../app/context/providers", () => ({
  useRound: () => ({ pool: "0x5FbDB2315678afecb367f032d93F642f64180aa3", after: state.after, markMined: () => {} }),
}));
import { useRoundSnapshot, useVoter } from "../app/hooks/use-snapshot";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
afterEach(() => vi.unstubAllGlobals());

test("useRoundSnapshot fetches the configured pool and passes after", async () => {
  state.after = 42;
  const f = vi.fn(async () => new Response(JSON.stringify({ block: 42 }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  const { result } = renderHook(() => useRoundSnapshot(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual({ block: 42 }));
  expect(f).toHaveBeenCalledWith("/api/round?pool=0x5FbDB2315678afecb367f032d93F642f64180aa3&after=42");
});

test("useVoter fetches the connected address", async () => {
  state.after = undefined;
  const f = vi.fn(async () => new Response(JSON.stringify({ inRoster: true }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  const { result } = renderHook(() => useVoter(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual({ inRoster: true }));
  expect(String(f.mock.calls[0][0])).toBe(
    "/api/voter/0x70997970C51812dc3A010C7d01b50e0d17dc79C8?pool=0x5FbDB2315678afecb367f032d93F642f64180aa3",
  );
});
```

- [ ] **Step 9: Run the hook tests, the whole suite, and the type check**

Run: `deno run -A npm:vitest run test/snapshot-hooks.test.tsx && deno task test && deno task typecheck`
Expected: 2 pass; suite 25 pass (20 + 3 + 2); typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add app/lib/api-types.ts app/lib/api.ts app/hooks app/context/providers.tsx test/api.test.ts test/snapshot-hooks.test.tsx
git commit -m "Add the read API client, snapshot hooks, and the after-transaction signal"
```

---

### Task 2: Formatting helpers and the atoms Money, Address, Countdown, Badge, Skeleton

**Files:**
- Create: `web/app/lib/format.ts`, `web/app/components/ui/money.tsx`, `web/app/components/ui/address.tsx`, `web/app/components/ui/countdown.tsx`, `web/app/components/ui/badge.tsx`, `web/app/components/ui/skeleton.tsx`
- Modify: `web/app/components/ui/index.tsx` (re-export the atoms; replace `Status` with `Badge`), `web/app/components/proposals/proposal-card.tsx` (use `Badge`)
- Test: `web/test/format.test.ts`, `web/test/atoms.test.tsx`

**Interfaces:**
- Produces: `formatAmount(amount: string | bigint, decimals: number, maxFraction = 2): { shown: string; full: string }`, `shortAddress(address)`, `formatDuration(seconds)`, `formatDateTime(unix)`, `isoDate(unix)`, `formatAgo(seconds)`; `<Money amount decimals symbol maxFraction? />`, `<Address address full? copy? />`, `<Countdown to now />`, `<Badge tone? >` with tones `neutral | success | error | info | signal`, `<Skeleton lines? />`.

- [ ] **Step 1: Write the failing format tests `web/test/format.test.ts`**

```ts
import { expect, test } from "vitest";
import { formatAgo, formatAmount, formatDuration, shortAddress } from "../app/lib/format";

test("formatAmount groups thousands, trims to two decimals, keeps the exact value", () => {
  expect(formatAmount("4000000000", 6)).toEqual({ shown: "4,000", full: "4000" });
  expect(formatAmount("1234567890", 6)).toEqual({ shown: "1,234.56", full: "1234.56789" });
  expect(formatAmount("1000000", 6)).toEqual({ shown: "1", full: "1" });
  expect(formatAmount("5", 6).shown).toBe("0");
  expect(formatAmount("5", 6).full).toBe("0.000005");
  expect(formatAmount(1500n, 0, 2).shown).toBe("1,500");
});

test("shortAddress checksums and shortens", () => {
  expect(shortAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3")).toBe("0x5FbD…0aa3");
});

test("formatDuration reads like a sentence", () => {
  expect(formatDuration(2 * 86400 + 3 * 3600 + 40)).toBe("2 days 3 hours");
  expect(formatDuration(86400)).toBe("1 day");
  expect(formatDuration(3 * 3600 + 12 * 60)).toBe("3 hours 12 minutes");
  expect(formatDuration(59)).toBe("less than a minute");
  expect(formatDuration(0)).toBe("ended");
});

test("formatAgo", () => {
  expect(formatAgo(3)).toBe("just now");
  expect(formatAgo(45)).toBe("45 seconds ago");
  expect(formatAgo(61)).toBe("1 minute ago");
  expect(formatAgo(7200)).toBe("2 hours ago");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run test/format.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/app/lib/format.ts`**

```ts
/** Display formatting. Amounts keep the exact value in `full`; `shown` is for the eye. */
import { formatUnits, getAddress } from "viem";

export function formatAmount(amount: string | bigint, decimals: number, maxFraction = 2) {
  const full = formatUnits(BigInt(amount), decimals);
  const [int, frac = ""] = full.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cut = frac.slice(0, maxFraction).replace(/0+$/, "");
  return { shown: cut ? `${grouped}.${cut}` : grouped, full };
}

export function shortAddress(address: string): string {
  const a = getAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
  if (h > 0) return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m > 0) return unit(m, "minute");
  return "less than a minute";
}

export function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

export function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${unit(m, "minute")} ago`;
  return `${unit(Math.floor(m / 60), "hour")} ago`;
}
```

- [ ] **Step 4: Run the format tests**

Run: `deno run -A npm:vitest run test/format.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Write the failing atom tests `web/test/atoms.test.tsx`**

```tsx
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
```

- [ ] **Step 6: Run to see them fail**

Run: `deno run -A npm:vitest run test/atoms.test.tsx`
Expected: FAIL, exports missing.

- [ ] **Step 7: Write the atoms**

`web/app/components/ui/money.tsx`:

```tsx
import { formatAmount } from "../../lib/format";

export function Money(
  { amount, decimals, symbol, maxFraction = 2 }: {
    amount: string | bigint;
    decimals: number;
    symbol: string;
    maxFraction?: number;
  },
) {
  const { shown, full } = formatAmount(amount, decimals, maxFraction);
  return (
    <span className="tabular-nums whitespace-nowrap" title={`${full} ${symbol}`}>
      {shown} {symbol}
    </span>
  );
}
```

`web/app/components/ui/address.tsx`:

```tsx
import { useState } from "react";
import { getAddress } from "viem";
import { shortAddress } from "../../lib/format";

export function Address(
  { address, full = false, copy = false }: { address: string; full?: boolean; copy?: boolean },
) {
  const [copied, setCopied] = useState(false);
  const checksummed = getAddress(address);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(checksummed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable: the full value is still in the title
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="font-mono text-sm break-all" title={checksummed}>
        {full ? checksummed : shortAddress(checksummed)}
      </code>
      {copy && (
        <button
          type="button"
          className="text-sm text-secondary underline underline-offset-4 hover:text-primary"
          onClick={onCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      <span role="status" className="sr-only">{copied ? "Address copied" : ""}</span>
    </span>
  );
}
```

`web/app/components/ui/countdown.tsx`:

```tsx
import { formatDateTime, formatDuration, isoDate } from "../../lib/format";

export function Countdown({ to, now }: { to: number; now: number }) {
  return (
    <time dateTime={isoDate(to)} title={formatDateTime(to)}>
      {formatDuration(to - now)}
    </time>
  );
}
```

`web/app/components/ui/badge.tsx`:

```tsx
import type { ReactNode } from "react";

const tones = {
  neutral: "border-edge-strong text-primary",
  success: "border-success text-success bg-info-bg",
  error: "border-error text-error bg-error-bg",
  info: "border-edge-strong text-secondary bg-info-bg",
  signal: "border-signal text-signal-text",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}
```

`web/app/components/ui/skeleton.tsx`:

```tsx
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded-sm bg-sunken" style={{ width: `${90 - (i % 3) * 20}%` }} />
      ))}
    </div>
  );
}
```

In `web/app/components/ui/index.tsx`: delete the `Status` function and add at the end:

```ts
export { Money } from "./money";
export { Address } from "./address";
export { Countdown } from "./countdown";
export { Badge, type BadgeTone } from "./badge";
export { Skeleton } from "./skeleton";
```

In `web/app/components/proposals/proposal-card.tsx`: replace the `Status` import and usage with `Badge`:
`<Badge tone={(["info", "success", "error"] as const)[proposal.status] ?? "neutral"}>{statuses[proposal.status]}</Badge>`.

- [ ] **Step 8: Run the atom tests and the whole suite**

Run: `deno run -A npm:vitest run test/atoms.test.tsx && deno task test && deno task typecheck`
Expected: 4 pass; suite 33 pass; typecheck clean. The existing `components.test.tsx` still passes with the badge texts unchanged.

- [ ] **Step 9: Commit**

```bash
git add app/lib/format.ts app/components/ui app/components/proposals/proposal-card.tsx test/format.test.ts test/atoms.test.tsx
git commit -m "Add formatting helpers and the Money, Address, Countdown, Badge, and Skeleton atoms"
```

---

### Task 3: Molecules SupportBar, StageStep, RuleLine

**Files:**
- Create: `web/app/components/ui/support-bar.tsx`, `web/app/components/ui/stage-step.tsx`, `web/app/components/ui/rule-line.tsx`
- Modify: `web/app/components/ui/index.tsx` (re-export)
- Test: `web/test/molecules.test.tsx`

**Interfaces:**
- Produces: `<SupportBar commitment cost decimals symbol />`, `<StageStep label state showDetail? >children</StageStep>`, `<RuleLine>children</RuleLine>`.

- [ ] **Step 1: Write the failing tests `web/test/molecules.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { RuleLine, StageStep, SupportBar } from "../app/components/ui";

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
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run test/molecules.test.tsx`
Expected: FAIL, exports missing.

- [ ] **Step 3: Write the molecules**

`web/app/components/ui/support-bar.tsx`:

```tsx
import { formatAmount } from "../../lib/format";

/** Public commitment relative to cost. The sealed total is never drawn here:
 * sealed weight is one number for the whole pool. */
export function SupportBar(
  { commitment, cost, decimals, symbol }: {
    commitment: string;
    cost: string;
    decimals: number;
    symbol: string;
  },
) {
  const c = BigInt(commitment);
  const k = BigInt(cost);
  const pct = k === 0n ? 0 : Number((c * 1000n) / k) / 10;
  const width = Math.min(100, pct);
  const label = `Public commitment ${formatAmount(c, decimals).shown} of ${formatAmount(k, decimals).shown} ${symbol}`;
  return (
    <div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-label={label}
        className="h-2 w-full bg-sunken"
      >
        <div className="h-full bg-success" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-sm text-secondary tabular-nums">
        {pct >= 100 ? "Cost covered by public commitments" : `${pct}% of cost`}
      </p>
    </div>
  );
}
```

`web/app/components/ui/stage-step.tsx`:

```tsx
import type { ReactNode } from "react";
import type { StepState } from "../../lib/api-types";

export function StageStep(
  { label, state, showDetail = false, children }: {
    label: string;
    state: StepState;
    /** When two steps are current at once, only one shows the detail. */
    showDetail?: boolean;
    children?: ReactNode;
  },
) {
  const tone = state === "current"
    ? "border-signal text-primary"
    : state === "done"
    ? "border-edge-strong text-secondary"
    : "border-edge text-secondary";
  return (
    <li aria-current={state === "current" ? "step" : undefined} className={`border-t-[3px] pt-2 ${tone}`}>
      <span className={`text-sm ${state === "current" ? "font-semibold" : ""}`}>{label}</span>
      {state === "current" && showDetail && children && <div className="mt-1 text-sm">{children}</div>}
    </li>
  );
}
```

`web/app/components/ui/rule-line.tsx`:

```tsx
import type { ReactNode } from "react";

/** One sentence at the moment of choice (design principle 3). */
export function RuleLine({ children }: { children: ReactNode }) {
  return <p className="max-w-[var(--width-copy)] border-l-[3px] border-signal pl-3 text-sm">{children}</p>;
}
```

Add to `index.tsx`: `export { SupportBar } from "./support-bar"; export { StageStep } from "./stage-step"; export { RuleLine } from "./rule-line";`

- [ ] **Step 4: Run the tests and the suite**

Run: `deno run -A npm:vitest run test/molecules.test.tsx && deno task test && deno task typecheck`
Expected: 4 pass; suite 37 pass; clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/ui test/molecules.test.tsx
git commit -m "Add the SupportBar, StageStep, and RuleLine molecules"
```

---

### Task 4: The stage bar and its container

**Files:**
- Create: `web/app/components/stage/stage-bar.tsx`, `web/app/components/stage/stage-bar-container.tsx`, `web/app/lib/close.ts`, `web/test/fixtures/snapshots.ts`
- Test: `web/test/stage-bar.test.tsx`

**Interfaces:**
- Consumes: `RoundSnapshot`, `Countdown`, `StageStep`, `Button`, `Notice`, `useRoundSnapshot`, `useNow`, `useRound().markMined`, `assertWallet(publicClient, wallet, account)` from `app/lib/transactions.ts`, `errorMessage` from `app/lib/proposals.ts`.
- Produces: `<StageBar snapshot now canClose closing onCloseBatch? closeError? />`; `<StageBarContainer />`; `sendClose(publicClient, wallet, pool, maxVoters): Promise<receipt>`; `CLOSE_CHUNK` from `VITE_CLOSE_CHUNK` (default 100); fixtures `openSnapshot`, `setupSnapshot`, `closingSnapshot`, `provingNoirSnapshot`, `provingZiskSnapshot`, `plainTallySnapshot`, `provenSnapshot`, `paidSnapshot`, `abandonedSnapshot`, `attestedSnapshot`.

- [ ] **Step 1: Write the fixtures `web/test/fixtures/snapshots.ts`**

```ts
import type { Finality, PhaseName, RoundSnapshot, StepKey, StepState } from "../../app/lib/api-types";

const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const DEADLINE = 1_700_003_600;
export const NOW = 1_700_000_000;
const ORDER: StepKey[] = ["proposals", "setup", "open", "closing", "proving", "proven", "paid"];

function stage(current: StepKey, opts: { alsoCurrent?: StepKey[]; plain?: boolean; finality?: Finality | null; paidNext?: boolean } = {}) {
  const index = ORDER.indexOf(current);
  const provenLabel = { proven: "Proven", attested: "Provisional", abandoned: "Abandoned", counted: "Counted" } as const;
  const labels: Record<StepKey, string> = {
    proposals: "Proposals", setup: "Setup", open: "Open", closing: "Closing",
    proving: opts.plain ? "Counting" : "Proving",
    proven: opts.finality ? provenLabel[opts.finality] : opts.plain ? "Counted" : "Proven",
    paid: "Paid",
  };
  return {
    current,
    steps: ORDER.map((key, i) => ({
      key,
      label: labels[key],
      state: (i === index || opts.alsoCurrent?.includes(key) ? "current" : i < index ? "done" : "next") as StepState,
    })),
  };
}

const base: RoundSnapshot = {
  pool: POOL, kind: "zisk", chainId: 31337, block: 123, at: NOW - 12,
  token: { address: TOKEN, symbol: "USDC", decimals: 6 },
  phase: "open", votingDeadline: DEADLINE,
  totalWeight: "1300000000", spent: "0", claimedTotal: "0",
  projects: [
    { id: 0, cost: "4000000000", recipient: B, contentRef: ("0x" + "ab".repeat(32)) as `0x${string}`, commitment: "300000000", funded: false, claimed: false, title: "Formal audit of the tally" },
    { id: 1, cost: "2500000000", recipient: A, contentRef: ("0x" + "00".repeat(32)) as `0x${string}`, commitment: "1000000000", funded: false, claimed: false, title: null },
  ],
  fundedOrder: [], proposalCount: 3, voterCount: 2,
  sealed: { total: "500000000", count: 1, commitmentsAvailable: true },
  closing: { closed: false, cursor: 0 }, proving: null, finality: null,
  graces: { abandonFrom: null, provisionalFrom: null },
  stage: stage("open"),
};

const withPhase = (phase: PhaseName, extra: Partial<RoundSnapshot>): RoundSnapshot => ({ ...base, phase, ...extra });

export const openSnapshot = base;
export const setupSnapshot = withPhase("setup", { stage: stage("setup", { alsoCurrent: ["proposals"] }) });
export const closingSnapshot = withPhase("closing", { closing: { closed: false, cursor: 1 }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: null }, stage: stage("closing") });
export const provingZiskSnapshot = withPhase("tally", { closing: { closed: true, cursor: 2 }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: null }, stage: stage("proving") });
export const provingNoirSnapshot = withPhase("tally", { kind: "noir", closing: { closed: true, cursor: 2 }, proving: { accepted: 1, total: 4 }, sealed: { total: "500000000", count: 1, commitmentsAvailable: false }, graces: { abandonFrom: DEADLINE + 604_800, provisionalFrom: DEADLINE + 90_000 }, stage: stage("proving") });
export const plainTallySnapshot = withPhase("tally", { kind: "plain", closing: null, proving: { accepted: 2, total: null }, sealed: { total: "0", count: 0, commitmentsAvailable: true }, stage: stage("proving", { plain: true }) });
export const provenSnapshot = withPhase("done", { finality: "proven", spent: "4000000000", fundedOrder: [0], projects: [{ ...base.projects[0], funded: true }, base.projects[1]], closing: { closed: true, cursor: 2 }, stage: stage("proven", { finality: "proven" }) });
export const paidSnapshot = { ...provenSnapshot, claimedTotal: "4000000000", projects: [{ ...provenSnapshot.projects[0], claimed: true }, provenSnapshot.projects[1]], stage: stage("paid", { finality: "proven" }) };
export const attestedSnapshot = { ...provenSnapshot, finality: "attested" as const, stage: stage("proven", { finality: "attested" }) };
export const abandonedSnapshot = withPhase("done", { finality: "abandoned", closing: { closed: true, cursor: 2 }, stage: stage("proven", { finality: "abandoned" }) });
```

- [ ] **Step 2: Write the failing stage bar tests `web/test/stage-bar.test.tsx`**

```tsx
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StageBar } from "../app/components/stage/stage-bar";
import {
  abandonedSnapshot, attestedSnapshot, closingSnapshot, DEADLINE, NOW, openSnapshot, paidSnapshot,
  plainTallySnapshot, provenSnapshot, provingNoirSnapshot, provingZiskSnapshot, setupSnapshot,
} from "./fixtures/snapshots";

const bar = (snapshot: typeof openSnapshot, extra: Partial<Parameters<typeof StageBar>[0]> = {}) =>
  render(<StageBar snapshot={snapshot} now={NOW} canClose={false} closing={false} {...extra} />);

test("lists the seven steps and marks open as current with the deadline", () => {
  bar(openSnapshot);
  const nav = screen.getByRole("navigation", { name: "Round stage" });
  expect(within(nav).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 5))).toHaveLength(7);
  const current = within(nav).getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
  expect(current).toHaveLength(1);
  expect(current[0].textContent).toContain("Open");
  expect(current[0].textContent).toContain("Voting closes in 1 hour");
  expect(current[0].textContent).toContain("voting closes on");
  expect(current[0].querySelectorAll("time")[1].getAttribute("dateTime")).toBe(new Date(DEADLINE * 1000).toISOString());
});

test("setup marks proposals and setup current and shows the detail once", () => {
  bar(setupSnapshot);
  const current = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
  expect(current.map((li) => li.textContent?.startsWith("Proposals") || li.textContent?.startsWith("Setup"))).toEqual([true, true]);
  expect(screen.getAllByText(/Submissions close on/)).toHaveLength(1);
});

test("closing shows roster progress and the close button only when a wallet can act", () => {
  const onCloseBatch = vi.fn();
  const { rerender } = bar(closingSnapshot, { canClose: true, onCloseBatch });
  expect(screen.getByText("1 of 2 voters closed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close next batch" }));
  expect(onCloseBatch).toHaveBeenCalledOnce();
  rerender(<StageBar snapshot={closingSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.queryByRole("button", { name: "Close next batch" })).toBeNull();
  rerender(<StageBar snapshot={{ ...closingSnapshot, closing: { closed: true, cursor: 2 } }} now={NOW} canClose closing={false} onCloseBatch={onCloseBatch} />);
  expect(screen.queryByRole("button", { name: "Close next batch" })).toBeNull();
});

test("proving shows progress or the waiting sentence, and the grace dates", () => {
  const { rerender } = bar(provingZiskSnapshot);
  expect(screen.getByText(/waiting for the first proof/i)).toBeTruthy();
  expect(screen.getByText(/abandonment possible from/i)).toBeTruthy();
  expect(screen.queryByText(/provisional result possible from/i)).toBeNull();
  rerender(<StageBar snapshot={provingNoirSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("1 of 4 proof batches accepted")).toBeTruthy();
  expect(screen.getByText(/provisional result possible from/i)).toBeTruthy();
  rerender(<StageBar snapshot={plainTallySnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("2 tally steps accepted")).toBeTruthy();
  expect(screen.getByText("Counting")).toBeTruthy();
});

test("done stages carry the finality label and the paid state", () => {
  const { rerender } = bar(provenSnapshot);
  expect(screen.getByText("Proven")).toBeTruthy();
  expect(screen.getByText("1 of 2 projects funded")).toBeTruthy();
  rerender(<StageBar snapshot={paidSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("All funded projects have been paid")).toBeTruthy();
  rerender(<StageBar snapshot={attestedSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("Provisional")).toBeTruthy();
  rerender(<StageBar snapshot={abandonedSnapshot} now={NOW} canClose={false} closing={false} />);
  expect(screen.getByText("Abandoned")).toBeTruthy();
});

test("a close error is announced", () => {
  bar(closingSnapshot, { canClose: true, closeError: "User rejected the request." });
  expect(screen.getByRole("alert").textContent).toContain("User rejected the request.");
});
```

- [ ] **Step 3: Run to see them fail**

Run: `deno run -A npm:vitest run test/stage-bar.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `web/app/lib/close.ts`, the stage bar, and its container**

`web/app/lib/close.ts`:

```ts
import { type Address, parseAbi, type PublicClient, type WalletClient } from "viem";
import { assertWallet } from "./transactions";

export const closeAbi = parseAbi(["function close(uint256 maxVoters)"]);
export const CLOSE_CHUNK = BigInt((import.meta.env.VITE_CLOSE_CHUNK as string | undefined) || "100");

/** One close(maxVoters) transaction; anyone may send it after the deadline. */
export async function sendClose(publicClient: PublicClient, wallet: WalletClient, pool: Address, maxVoters = CLOSE_CHUNK) {
  const account = wallet.account;
  if (!account) throw new Error("Connect a wallet to close the roster.");
  await assertWallet(publicClient, wallet, account.address);
  const hash = await wallet.writeContract({ address: pool, abi: closeAbi, functionName: "close", args: [maxVoters], account, chain: wallet.chain });
  return publicClient.waitForTransactionReceipt({ hash });
}
```

Check `assertWallet`'s exact parameters in `app/lib/transactions.ts` before writing; if its third argument is the account object rather than the address, pass `account`.

`web/app/components/stage/stage-bar.tsx`:

```tsx
import type { ReactNode } from "react";
import type { RoundSnapshot, StepKey } from "../../lib/api-types";
import { formatDateTime, isoDate } from "../../lib/format";
import { Button, Countdown, Notice, StageStep } from "../ui";

export interface StageBarProps {
  snapshot: RoundSnapshot;
  now: number;
  canClose: boolean;
  closing: boolean;
  onCloseBatch?: () => void;
  closeError?: string;
}

const When = ({ at }: { at: number }) => <time dateTime={isoDate(at)}>{formatDateTime(at)}</time>;

function provingText(s: RoundSnapshot): string {
  if (!s.proving) return "Waiting for the first proof";
  if (s.kind === "plain") return `${s.proving.accepted} tally ${s.proving.accepted === 1 ? "step" : "steps"} accepted`;
  if (s.proving.total !== null) return `${s.proving.accepted} of ${s.proving.total} proof batches accepted`;
  return `${s.proving.accepted} proofs accepted`;
}

export function StageBar({ snapshot: s, now, canClose, closing, onCloseBatch, closeError }: StageBarProps) {
  const detail = (key: StepKey): ReactNode => {
    switch (key) {
      case "proposals":
      case "setup":
        return <>Submissions close on <When at={s.votingDeadline} /></>;
      case "open":
        return (
          <>
            Voting closes in <Countdown to={s.votingDeadline} now={now} />, voting closes on <When at={s.votingDeadline} />
          </>
        );
      case "closing":
        if (s.kind === "plain") return "Waiting for the tally to start";
        return (
          <>
            <div>{`${s.closing?.cursor ?? 0} of ${s.voterCount} voters closed`}</div>
            {!s.closing?.closed && canClose && (
              <Button variant="secondary" className="mt-2" disabled={closing} onClick={onCloseBatch}>
                {closing ? "Closing…" : "Close next batch"}
              </Button>
            )}
            {closeError && <Notice error>{closeError}</Notice>}
          </>
        );
      case "proving":
        return (
          <>
            <div>{provingText(s)}</div>
            {s.graces.provisionalFrom !== null && <div>Provisional result possible from <When at={s.graces.provisionalFrom} /></div>}
            {s.graces.abandonFrom !== null && <div>Abandonment possible from <When at={s.graces.abandonFrom} /></div>}
          </>
        );
      case "proven":
        return `${s.fundedOrder.length} of ${s.projects.length} projects funded`;
      case "paid":
        return "All funded projects have been paid";
    }
  };
  return (
    <nav aria-label="Round stage" className="border-b border-edge py-4">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {s.stage.steps.map((step) => (
          <StageStep key={step.key} label={step.label} state={step.state} showDetail={step.key === s.stage.current}>
            {detail(step.key)}
          </StageStep>
        ))}
      </ol>
    </nav>
  );
}
```

`web/app/components/stage/stage-bar-container.tsx`:

```tsx
import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useRound } from "../../context/providers";
import { useNow } from "../../hooks/use-now";
import { useRoundSnapshot } from "../../hooks/use-snapshot";
import { sendClose } from "../../lib/close";
import { errorMessage } from "../../lib/proposals";
import { Notice, Skeleton } from "../ui";
import { StageBar } from "./stage-bar";

/** Wires the stage bar to the snapshot, the clock, and the close action. */
export function StageBarContainer() {
  const round = useRoundSnapshot();
  const now = useNow(60_000);
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const { pool, markMined } = useRound();
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string>();

  async function closeBatch() {
    if (!wallet || !pool || !publicClient) return;
    setClosing(true);
    setCloseError(undefined);
    try {
      const receipt = await sendClose(publicClient, wallet, pool);
      markMined(Number(receipt.blockNumber));
    } catch (e) {
      setCloseError(errorMessage(e));
    } finally {
      setClosing(false);
    }
  }

  if (!pool) return null;
  if (!round.data) {
    return round.isError ? <Notice error>Could not load the round: {errorMessage(round.error)}</Notice> : <Skeleton lines={1} />;
  }
  return (
    <StageBar
      snapshot={round.data}
      now={now}
      canClose={!!address && !!wallet}
      closing={closing}
      onCloseBatch={closeBatch}
      closeError={closeError}
    />
  );
}
```

- [ ] **Step 5: Run the tests, suite, and type check**

Run: `deno run -A npm:vitest run test/stage-bar.test.tsx && deno task test && deno task typecheck`
Expected: 6 pass; suite 43 pass; clean.

- [ ] **Step 6: Commit**

```bash
git add app/components/stage app/lib/close.ts test/fixtures test/stage-bar.test.tsx
git commit -m "Add the stage bar with closing, proving, and outcome details, and its container"
```

---

### Task 5: The round page

**Files:**
- Create: `web/app/components/round/board.tsx`, `web/app/components/round/sealed-panel.tsx`, `web/app/components/round/your-ballot.tsx`, `web/app/components/round/outcome.tsx`, `web/app/components/round/round-heading.tsx`, `web/app/lib/copy.ts`, `web/app/routes/round.tsx`
- Test: `web/test/round-page.test.tsx`

**Interfaces:**
- Consumes: fixtures, atoms, molecules, hooks.
- Produces: `<Board snapshot />`, `<SealedPanel snapshot />`, `<YourBallot snapshot voter loading />`, `<Outcome snapshot />`, `<RoundHeading snapshot now name />`; `FINALITY_SENTENCES`, `REPO_URL`, `ROUND_NAME` in `copy.ts`; the route module `routes/round.tsx` (default export `RoundPage`), not yet in `routes.ts` (Task 7 wires it).

- [ ] **Step 1: Write `web/app/lib/copy.ts`**

```ts
/** Copy fixed by the spec (section 2, decision 11) and the design principles. */
import type { Finality } from "./api-types";

export const ROUND_NAME = (import.meta.env.VITE_ROUND_NAME as string | undefined) || "RankedShares round";
export const REPO_URL = ((import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/sembrestels/ranked-shares").replace(/\/+$/, "");
export const AUDIT_URL = `${REPO_URL}#sealed-pools`;

export const FINALITY_LABEL: Record<Finality, string> = {
  proven: "Proven",
  attested: "Provisional",
  abandoned: "Abandoned",
  counted: "Counted",
};

export const FINALITY_SENTENCE: Record<Finality, string> = {
  proven: "the sealed ballots were proven against their commitments and the public ballots can be replayed from chain data",
  attested: "the operator's report was accepted after the proof grace period without a proof; the funded set stands",
  abandoned: "no result arrived before the abandonment deadline; no project is funded and the organiser can sweep the pool",
  counted: "the tally ran on-chain and can be replayed from chain data",
};

export const NOT_CAST = "Your ballot: not cast. Money without a ballot funds nothing.";
export const NO_PITCH = "No pitch was published for this project";
export const PITCH_FAILED = "The pitch could not be loaded; try again";
export const AUDIT_LABEL = "check this result yourself";
```

- [ ] **Step 2: Write the failing page tests `web/test/round-page.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { Board } from "../app/components/round/board";
import { SealedPanel } from "../app/components/round/sealed-panel";
import { YourBallot } from "../app/components/round/your-ballot";
import { Outcome } from "../app/components/round/outcome";
import { RoundHeading } from "../app/components/round/round-heading";
import { abandonedSnapshot, attestedSnapshot, DEADLINE, NOW, openSnapshot, provenSnapshot, provingNoirSnapshot } from "./fixtures/snapshots";

const inRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("Board lists projects by public commitment, descending, with name, cost, and commitment", () => {
  inRouter(<Board snapshot={openSnapshot} />);
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole("link").textContent).toBe("Project 1");
  expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/project/1");
  expect(within(rows[0]).getByTitle("1000 USDC").textContent).toBe("1,000 USDC");
  expect(within(rows[1]).getByRole("link").textContent).toBe("Formal audit of the tally");
  expect(within(rows[1]).getByTitle("4000 USDC").textContent).toBe("4,000 USDC");
  expect(within(rows[1]).getByRole("meter").getAttribute("aria-valuenow")).toBe("8");
});

test("Board shows the funded badge once the outcome is set", () => {
  inRouter(<Board snapshot={provenSnapshot} />);
  expect(screen.getByText("Funded")).toBeTruthy();
});

test("SealedPanel shows the sealed weight and count, and the noir caveat", () => {
  const { rerender } = render(<SealedPanel snapshot={openSnapshot} />);
  expect(screen.getByText("Sealed weight").nextSibling?.textContent).toBe("500 USDC");
  expect(screen.getByText("Sealed ballots").nextSibling?.textContent).toBe("1");
  rerender(<SealedPanel snapshot={provingNoirSnapshot} />);
  expect(screen.getByText(/Public commitments are not available for this pool variant/)).toBeTruthy();
});

test("YourBallot: not cast, sealed in the roster, public and final", () => {
  const { rerender } = inRouter(
    <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "300000000", seats: "0", total: "300000000" }, ballot: { public: null, sealed: false }, inRoster: true }} />,
  );
  expect(screen.getByText("Your ballot: not cast. Money without a ballot funds nothing.")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/vote");
  rerender(
    <MemoryRouter>
      <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "0", seats: "500000000", total: "500000000" }, ballot: { public: null, sealed: true }, inRoster: true }} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Your ballot: sealed, in the roster, replaceable until/).textContent).toContain(new Date(DEADLINE * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  expect(screen.getByRole("link").getAttribute("href")).toBe("/ballot");
  rerender(
    <MemoryRouter>
      <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "300000000", seats: "0", total: "300000000" }, ballot: { public: { ranks: [2, 1] }, sealed: false }, inRoster: true }} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Your ballot: public and final/)).toBeTruthy();
});

test("YourBallot renders nothing for an address with no weight and no ballot", () => {
  const { container } = inRouter(
    <YourBallot snapshot={openSnapshot} loading={false} voter={{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", block: 123, weight: { direct: "0", seats: "0", total: "0" }, ballot: { public: null, sealed: false }, inRoster: false }} />,
  );
  expect(container.textContent).toBe("");
});

test("Outcome lists the funded set in order, the finality in words, and the audit link", () => {
  const { rerender } = inRouter(<Outcome snapshot={provenSnapshot} />);
  expect(screen.getByText("Proven")).toBeTruthy();
  expect(screen.getByText(/the sealed ballots were proven against their commitments/)).toBeTruthy();
  const funded = screen.getByRole("list", { name: "Funded projects" });
  expect(within(funded).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Formal audit of the tally, 4,000 USDC"]);
  expect(screen.getByText("Project 1, not funded")).toBeTruthy();
  expect(screen.getByRole("link", { name: "check this result yourself" }).getAttribute("href")).toBe("https://github.com/sembrestels/ranked-shares#sealed-pools");
  rerender(<MemoryRouter><Outcome snapshot={attestedSnapshot} /></MemoryRouter>);
  expect(screen.getByText("Provisional")).toBeTruthy();
  expect(screen.getByText(/accepted after the proof grace period without a proof; the funded set stands/)).toBeTruthy();
  rerender(<MemoryRouter><Outcome snapshot={abandonedSnapshot} /></MemoryRouter>);
  expect(screen.getByText("Abandoned")).toBeTruthy();
  expect(screen.getByText(/no project is funded and the organiser can sweep the pool/)).toBeTruthy();
});

test("RoundHeading names the round, the pool total, and when the snapshot was taken", () => {
  render(<RoundHeading snapshot={openSnapshot} now={NOW} name="Autumn grants" />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Autumn grants");
  expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("1,300 USDC in the pool");
  expect(screen.getByText("Updated 12 seconds ago")).toBeTruthy();
});
```

- [ ] **Step 3: Run to see them fail**

Run: `deno run -A npm:vitest run test/round-page.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the round components**

`web/app/components/round/board.tsx`:

```tsx
import { Link } from "react-router";
import type { RoundSnapshot } from "../../lib/api-types";
import { Badge, Money, SupportBar } from "../ui";

export const projectName = (p: { id: number; title: string | null }) => p.title ?? `Project ${p.id}`;

/** Public commitments per project, most backed first. */
export function Board({ snapshot: s }: { snapshot: RoundSnapshot }) {
  const rows = [...s.projects].sort((a, b) => (BigInt(b.commitment) > BigInt(a.commitment) ? 1 : BigInt(b.commitment) < BigInt(a.commitment) ? -1 : a.id - b.id));
  const { symbol, decimals } = s.token;
  return (
    <section aria-labelledby="board-heading">
      <h2 id="board-heading" className="font-heading text-xl">Public commitments</h2>
      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((p) => (
          <li key={p.id} className="border border-edge bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <Link to={`/project/${p.id}`} className="font-heading text-lg">{projectName(p)}</Link>
              {s.finality && <Badge tone={p.funded ? "success" : "neutral"}>{p.funded ? "Funded" : "Not funded"}</Badge>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <dt className="text-secondary">Cost</dt>
              <dd><Money amount={p.cost} decimals={decimals} symbol={symbol} /></dd>
              <dt className="text-secondary">Public commitment</dt>
              <dd><Money amount={p.commitment} decimals={decimals} symbol={symbol} /></dd>
            </dl>
            <div className="mt-3">
              <SupportBar commitment={p.commitment} cost={p.cost} decimals={decimals} symbol={symbol} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`web/app/components/round/sealed-panel.tsx`:

```tsx
import type { RoundSnapshot } from "../../lib/api-types";
import { Money } from "../ui";

/** One number for the whole pool: sealed weight is never shown per project. */
export function SealedPanel({ snapshot: s }: { snapshot: RoundSnapshot }) {
  return (
    <aside aria-labelledby="sealed-heading" className="border border-edge bg-sunken p-6">
      <h2 id="sealed-heading" className="font-heading text-xl">Sealed side</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <dt className="text-secondary">Sealed weight</dt>
        <dd><Money amount={s.sealed.total} decimals={s.token.decimals} symbol={s.token.symbol} /></dd>
        <dt className="text-secondary">Sealed ballots</dt>
        <dd>{s.sealed.count}</dd>
      </dl>
      <p className="mt-3 text-sm text-secondary">Sealed ballots are counted after the deadline; nobody sees how they rank until then, and the result never reveals them.</p>
      {!s.sealed.commitmentsAvailable && <p className="mt-2 text-sm text-secondary">Public commitments are not available for this pool variant yet.</p>}
    </aside>
  );
}
```

`web/app/components/round/your-ballot.tsx`:

```tsx
import { Link } from "react-router";
import type { RoundSnapshot, VoterResponse } from "../../lib/api-types";
import { NOT_CAST } from "../../lib/copy";
import { formatDateTime, isoDate } from "../../lib/format";
import { Skeleton } from "../ui";

export function YourBallot({ snapshot: s, voter, loading }: { snapshot: RoundSnapshot; voter: VoterResponse | undefined; loading: boolean }) {
  if (loading && !voter) return <Skeleton lines={1} />;
  if (!voter) return null;
  const weight = BigInt(voter.weight.total);
  if (weight === 0n && !voter.ballot.public && !voter.ballot.sealed) return null;
  const deadline = <time dateTime={isoDate(s.votingDeadline)}>{formatDateTime(s.votingDeadline)}</time>;
  return (
    <section aria-label="Your ballot" className="border-l-[3px] border-signal bg-surface p-4 text-sm">
      {voter.ballot.sealed
        ? <p>Your ballot: sealed, {voter.inRoster ? "in the roster" : "not in the roster yet"}, replaceable until {deadline}. <Link to="/ballot" className="underline underline-offset-4">See your ballot</Link></p>
        : voter.ballot.public
        ? <p>Your ballot: public and final. <Link to="/ballot" className="underline underline-offset-4">See your ballot</Link></p>
        : <p>{NOT_CAST} <Link to="/vote" className="underline underline-offset-4">Rank the projects</Link></p>}
    </section>
  );
}
```

`web/app/components/round/outcome.tsx`:

```tsx
import type { RoundSnapshot } from "../../lib/api-types";
import { AUDIT_LABEL, AUDIT_URL, FINALITY_LABEL, FINALITY_SENTENCE } from "../../lib/copy";
import { formatAmount } from "../../lib/format";
import { Badge } from "../ui";
import { projectName } from "./board";

export function Outcome({ snapshot: s }: { snapshot: RoundSnapshot }) {
  if (!s.finality) return null;
  const { symbol, decimals } = s.token;
  const byId = new Map(s.projects.map((p) => [p.id, p]));
  const funded = s.fundedOrder.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const rest = s.projects.filter((p) => !s.fundedOrder.includes(p.id));
  const tone = s.finality === "abandoned" ? "error" : s.finality === "attested" ? "info" : "success";
  return (
    <section aria-labelledby="outcome-heading" className="border border-edge bg-surface p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="outcome-heading" className="font-heading text-xl">Outcome</h2>
        <Badge tone={tone}>{FINALITY_LABEL[s.finality]}</Badge>
      </div>
      <p className="mt-2 text-sm">{FINALITY_SENTENCE[s.finality]}.</p>
      {funded.length > 0 && (
        <ol aria-label="Funded projects" className="mt-4 list-decimal pl-6">
          {funded.map((p) => <li key={p.id}>{projectName(p)}, {formatAmount(p.cost, decimals).shown} {symbol}</li>)}
        </ol>
      )}
      {rest.length > 0 && (
        <ul aria-label="Not funded" className="mt-3 text-sm text-secondary">
          {rest.map((p) => <li key={p.id}>{projectName(p)}, not funded</li>)}
        </ul>
      )}
      {s.finality !== "abandoned" && (
        <p className="mt-4 text-sm"><a href={AUDIT_URL} className="underline underline-offset-4">{AUDIT_LABEL}</a></p>
      )}
    </section>
  );
}
```

`web/app/components/round/round-heading.tsx`:

```tsx
import type { RoundSnapshot } from "../../lib/api-types";
import { formatAgo } from "../../lib/format";
import { Money } from "../ui";

export function RoundHeading({ snapshot: s, now, name }: { snapshot: RoundSnapshot; now: number; name: string }) {
  return (
    <header className="py-8">
      <h1 className="font-heading text-display leading-heading tracking-tight">{name}</h1>
      <p className="mt-3 text-secondary"><Money amount={s.totalWeight} decimals={s.token.decimals} symbol={s.token.symbol} /> in the pool</p>
      <p className="mt-1 text-sm text-secondary">Updated {formatAgo(Math.max(0, now - s.at))}</p>
    </header>
  );
}
```

`web/app/routes/round.tsx`:

```tsx
import { useAccount } from "wagmi";
import { Board } from "../components/round/board";
import { Outcome } from "../components/round/outcome";
import { RoundHeading } from "../components/round/round-heading";
import { SealedPanel } from "../components/round/sealed-panel";
import { YourBallot } from "../components/round/your-ballot";
import { Notice, Skeleton } from "../components/ui";
import { useRound } from "../context/providers";
import { useNow } from "../hooks/use-now";
import { useRoundSnapshot, useVoter } from "../hooks/use-snapshot";
import { ROUND_NAME } from "../lib/copy";
import { errorMessage } from "../lib/proposals";

export default function RoundPage() {
  const { pool } = useRound();
  const { address } = useAccount();
  const round = useRoundSnapshot();
  const voter = useVoter();
  const now = useNow(10_000);
  if (!pool) return <Notice>Choose a round above to see the board.</Notice>;
  if (!round.data) {
    return round.isError ? <Notice error>Could not load the round: {errorMessage(round.error)}</Notice> : <Skeleton lines={6} />;
  }
  const s = round.data;
  return (
    <>
      {round.isError && <Notice error>Showing the last snapshot; the refresh failed: {errorMessage(round.error)}</Notice>}
      <RoundHeading snapshot={s} now={now} name={ROUND_NAME} />
      {address && <YourBallot snapshot={s} voter={voter.data} loading={voter.isPending} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Outcome snapshot={s} />
          <Board snapshot={s} />
        </div>
        <SealedPanel snapshot={s} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the tests, suite, and type check**

Run: `deno run -A npm:vitest run test/round-page.test.tsx && deno task test && deno task typecheck`
Expected: 7 pass; suite 50 pass; clean.

- [ ] **Step 6: Commit**

```bash
git add app/components/round app/lib/copy.ts app/routes/round.tsx test/round-page.test.tsx
git commit -m "Add the round page: heading, your ballot, board, sealed panel, and outcome"
```

---

### Task 6: The project page

**Files:**
- Create: `web/app/components/project/project-summary.tsx`, `web/app/components/project/pitch.tsx`, `web/app/routes/project.tsx`
- Test: `web/test/project-page.test.tsx`

**Interfaces:**
- Consumes: `ProjectResponse`, atoms, `useProject`, `useSwarm()` (for attachment downloads via `readContent` and `saveDownload` from `app/lib/swarm.ts`), `NO_PITCH`, `PITCH_FAILED`.
- Produces: `<ProjectSummary response />`, `<Pitch response onRetry onDownload />`, route module `routes/project.tsx` (default export `ProjectPage`), not yet in `routes.ts`.

- [ ] **Step 1: Write the failing tests `web/test/project-page.test.tsx`**

```tsx
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectSummary } from "../app/components/project/project-summary";
import { Pitch } from "../app/components/project/pitch";
import type { ProjectResponse } from "../app/lib/api-types";
import { openSnapshot, provenSnapshot } from "./fixtures/snapshots";

const slice = (s: typeof openSnapshot) => ({ pool: s.pool, kind: s.kind, block: s.block, at: s.at, token: s.token, phase: s.phase, finality: s.finality, stage: s.stage });
const withPitch: ProjectResponse = {
  project: openSnapshot.projects[0],
  round: slice(openSnapshot),
  contentStatus: "ok",
  content: { version: 1, title: "Formal audit of the tally", body: "Line one\n<b>not html</b>", attachments: [{ reference: "ab".repeat(32), name: "plan.pdf", type: "application/pdf", size: 20480 }] },
  reason: null,
};

test("ProjectSummary shows cost, public commitment, recipient in full with copy, and the meter", () => {
  render(<ProjectSummary response={withPitch} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Formal audit of the tally");
  expect(screen.getByText("Cost").nextSibling?.textContent).toBe("4,000 USDC");
  expect(screen.getByText("Public commitment").nextSibling?.textContent).toBe("300 USDC");
  expect(screen.getByText("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("meter")).toBeTruthy();
});

test("ProjectSummary states the outcome for a funded project", () => {
  render(<ProjectSummary response={{ ...withPitch, project: provenSnapshot.projects[0], round: slice(provenSnapshot) }} />);
  expect(screen.getByText("Funded")).toBeTruthy();
  expect(screen.getByText("Proven")).toBeTruthy();
});

test("Pitch renders the body as text, never HTML, and lists attachments with a download", () => {
  const onDownload = vi.fn();
  render(<Pitch response={withPitch} onRetry={() => {}} onDownload={onDownload} />);
  const body = screen.getByText(/Line one/);
  expect(body.textContent).toContain("<b>not html</b>");
  expect(body.querySelector("b")).toBeNull();
  expect(screen.getByText("plan.pdf")).toBeTruthy();
  expect(screen.getByText("20 KB")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Download plan.pdf" }));
  expect(onDownload).toHaveBeenCalledWith(withPitch.content!.attachments[0]);
});

test("Pitch explains a missing pitch and offers a retry when it could not be loaded", () => {
  const onRetry = vi.fn();
  const { rerender } = render(<Pitch response={{ ...withPitch, contentStatus: "none", content: null }} onRetry={onRetry} onDownload={() => {}} />);
  expect(screen.getByText("No pitch was published for this project")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  rerender(<Pitch response={{ ...withPitch, contentStatus: "unavailable", content: null, reason: "gateway answered 504" }} onRetry={onRetry} onDownload={() => {}} />);
  expect(screen.getByText("The pitch could not be loaded; try again")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run test/project-page.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the components and the route**

`web/app/components/project/project-summary.tsx`:

```tsx
import type { ProjectResponse } from "../../lib/api-types";
import { FINALITY_LABEL } from "../../lib/copy";
import { Address, Badge, Money, SupportBar } from "../ui";

export function ProjectSummary({ response: r }: { response: ProjectResponse }) {
  const p = r.project;
  const { symbol, decimals } = r.round.token;
  const title = p.title ?? r.content?.title ?? `Project ${p.id}`;
  return (
    <header className="py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-xl leading-heading">{title}</h1>
        {r.round.finality && (
          <>
            <Badge tone={p.funded ? "success" : "neutral"}>{p.funded ? "Funded" : "Not funded"}</Badge>
            <Badge tone="info">{FINALITY_LABEL[r.round.finality]}</Badge>
          </>
        )}
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-secondary">Cost</dt>
        <dd><Money amount={p.cost} decimals={decimals} symbol={symbol} /></dd>
        <dt className="text-secondary">Public commitment</dt>
        <dd><Money amount={p.commitment} decimals={decimals} symbol={symbol} /></dd>
        <dt className="text-secondary">Recipient</dt>
        <dd><Address address={p.recipient} full copy /></dd>
      </dl>
      <div className="mt-4 max-w-[var(--width-reading)]">
        <SupportBar commitment={p.commitment} cost={p.cost} decimals={decimals} symbol={symbol} />
      </div>
    </header>
  );
}
```

`web/app/components/project/pitch.tsx`:

```tsx
import type { Attachment, ProjectResponse } from "../../lib/api-types";
import { NO_PITCH, PITCH_FAILED } from "../../lib/copy";
import { Button, Notice } from "../ui";

const kb = (size: number) => `${Math.max(1, Math.round(size / 1024))} KB`;

/** The proposal text as text nodes only; attachments are downloaded as binary. */
export function Pitch(
  { response: r, onRetry, onDownload }: {
    response: ProjectResponse;
    onRetry: () => void;
    onDownload: (file: Attachment) => void;
  },
) {
  if (r.contentStatus === "none") return <Notice>{NO_PITCH}</Notice>;
  if (r.contentStatus === "unavailable" || !r.content) {
    return (
      <Notice error>
        {PITCH_FAILED} <Button variant="secondary" onClick={onRetry}>Try again</Button>
      </Notice>
    );
  }
  return (
    <section aria-labelledby="pitch-heading" className="max-w-[var(--width-reading)]">
      <h2 id="pitch-heading" className="font-heading text-xl">Pitch</h2>
      <div className="mt-3 whitespace-pre-wrap break-words">{r.content.body}</div>
      {r.content.attachments.length > 0 && (
        <ul aria-label="Attachments" className="mt-4 flex flex-col gap-2 text-sm">
          {r.content.attachments.map((file) => (
            <li key={file.reference} className="flex flex-wrap items-center gap-3">
              <span>{file.name}</span>
              <span className="text-secondary">{kb(file.size)}</span>
              <Button variant="secondary" onClick={() => onDownload(file)} aria-label={`Download ${file.name}`}>Download</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`web/app/routes/project.tsx`:

```tsx
import { useState } from "react";
import { useParams } from "react-router";
import { Pitch } from "../components/project/pitch";
import { ProjectSummary } from "../components/project/project-summary";
import { Notice, Skeleton } from "../components/ui";
import { useRound, useSwarm } from "../context/providers";
import { useProject } from "../hooks/use-snapshot";
import type { Attachment } from "../lib/api-types";
import { errorMessage } from "../lib/proposals";
import { readContent, saveDownload } from "../lib/swarm";

export default function ProjectPage() {
  const { id: raw } = useParams();
  const id = /^\d+$/.test(raw ?? "") ? Number(raw) : -1;
  const { pool } = useRound();
  const { client } = useSwarm();
  const project = useProject(id);
  const [downloadError, setDownloadError] = useState<string>();

  async function download(file: Attachment) {
    if (!client) {
      setDownloadError("Swarm is still connecting; try again in a moment.");
      return;
    }
    try {
      const bytes = await readContent(client, `0x${file.reference}`);
      saveDownload(bytes, file.name);
    } catch (e) {
      setDownloadError(errorMessage(e));
    }
  }

  if (id < 0) return <Notice error>This project id is not valid.</Notice>;
  if (!pool) return <Notice>Choose a round above to see this project.</Notice>;
  if (!project.data) {
    return project.isError ? <Notice error>Could not load the project: {errorMessage(project.error)}</Notice> : <Skeleton lines={6} />;
  }
  return (
    <>
      <ProjectSummary response={project.data} />
      <Pitch response={project.data} onRetry={() => project.refetch()} onDownload={download} />
      {downloadError && <Notice error>{downloadError}</Notice>}
    </>
  );
}
```

Check `readContent`'s signature in `app/lib/swarm.ts` (it takes the storage client and a `0x`-prefixed reference in the proposals board); match how `app/routes/board.tsx` calls it.

- [ ] **Step 4: Run the tests, suite, and type check**

Run: `deno run -A npm:vitest run test/project-page.test.tsx && deno task test && deno task typecheck`
Expected: 4 pass; suite 54 pass; clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/project app/routes/project.tsx test/project-page.test.tsx
git commit -m "Add the project page: summary, pitch as text, attachments, and outcome state"
```

---

### Task 7: The shell, the route table, and the proposals move

**Files:**
- Modify: `web/app/routes.ts`, `web/app/root.tsx`, `web/app/app.css`, `web/app/routes/board.tsx` (rename to `web/app/routes/proposals.tsx`), `web/app/routes/setup.tsx`, `web/app/routes/submit.tsx`, `web/test/workflow.test.tsx` (import path), `web/README.md` (routes)
- Test: `web/test/shell.test.tsx`

**Interfaces:**
- Consumes: `StageBarContainer`, the route modules of Tasks 5 and 6.
- Produces: routes `/` (round), `/project/:id`, `/proposals`, `/submit`, `/setup`; the shell layout with the stage bar under the header on every route.

- [ ] **Step 1: Move the proposals board and update the route table**

```bash
git mv app/routes/board.tsx app/routes/proposals.tsx
```

Replace `web/app/routes.ts` with:

```ts
import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/round.tsx"),
  route("project/:id", "routes/project.tsx"),
  route("proposals", "routes/proposals.tsx"),
  route("submit", "routes/submit.tsx"),
  route("setup", "routes/setup.tsx"),
] satisfies RouteConfig;
```

In `web/test/workflow.test.tsx` change `import { ProposalBoard } from "../app/routes/board";` to `"../app/routes/proposals"`. In `web/app/routes/setup.tsx` fix the import the same way.

- [ ] **Step 2: Write the failing shell test `web/test/shell.test.tsx`**

```tsx
import { expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, chainId: undefined }),
  useConnect: () => ({ connectAsync: async () => {}, connectors: [], isPending: false }),
  useDisconnect: () => ({ disconnect: () => {} }),
  useSwitchChain: () => ({ switchChainAsync: async () => {} }),
  usePublicClient: () => undefined,
  useWalletClient: () => ({ data: undefined }),
}));
vi.mock("../app/context/providers", () => ({
  chain: { id: 31337, name: "Anvil" },
  Providers: ({ children }: { children: ReactNode }) => <>{children}</>,
  useRound: () => ({ pool: undefined, setPool: () => {}, after: undefined, markMined: () => {} }),
  useSwarm: () => ({ client: undefined, info: undefined, error: undefined, retry: () => {} }),
}));
import { Shell } from "../app/root";

test("the shell has the wordmark, the four navigation links, and the stage bar slot", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><Shell><p>page</p></Shell></MemoryRouter>
    </QueryClientProvider>,
  );
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Round", "Proposals", "Submit an idea", "Organizer"]);
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/proposals", "/submit", "/setup"]);
  expect(screen.getByText("page")).toBeTruthy();
  expect(screen.getByRole("contentinfo").textContent).toContain("check this result yourself");
});
```

- [ ] **Step 3: Run to see it fail**

Run: `deno run -A npm:vitest run test/shell.test.tsx`
Expected: FAIL, `Shell` is not exported.

- [ ] **Step 4: Restyle `web/app/root.tsx`**

Keep `Layout`, `Providers`, the existing `Connections` and round picker logic intact (they work), and restructure the markup: extract the page frame into an exported `Shell` component used by the default export, with the stage bar under the header:

```tsx
export function Shell({ children }: { children: ReactNode }) {
  const { pool } = useRound();
  const search = pool ? `?pool=${pool}` : "";
  return (
    <div className="min-h-screen bg-page text-primary">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-surface focus:p-3">Skip to content</a>
      <header className="bg-inverse text-on-inverse">
        <div className="mx-auto flex w-[min(var(--width-page),calc(100%-var(--space-8)))] flex-wrap items-center justify-between gap-6 py-6">
          <NavLink to={`/${search}`} className="font-heading text-lg no-underline">RankedShares</NavLink>
          <nav aria-label="Main" className="flex flex-wrap gap-6 text-sm">
            <NavLink to={`/${search}`} end className={({ isActive }) => `border-b py-2 no-underline ${isActive ? "border-signal" : "border-transparent"}`}>Round</NavLink>
            <NavLink to={`/proposals${search}`} className={({ isActive }) => `border-b py-2 no-underline ${isActive ? "border-signal" : "border-transparent"}`}>Proposals</NavLink>
            <NavLink to={`/submit${search}`} className={({ isActive }) => `border-b py-2 no-underline ${isActive ? "border-signal" : "border-transparent"}`}>Submit an idea</NavLink>
            <NavLink to={`/setup${search}`} className={({ isActive }) => `border-b py-2 no-underline ${isActive ? "border-signal" : "border-transparent"}`}>Organizer</NavLink>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))]">
        <div className="toolbar">{/* the existing round picker and Connections markup, unchanged */}</div>
        <StageBarContainer />
        <main id="main" className="py-6">{children}</main>
      </div>
      <footer role="contentinfo" className="mt-12 border-t border-edge py-6 text-sm text-secondary">
        <div className="mx-auto w-[min(var(--width-page),calc(100%-var(--space-8)))]">
          <p>Every number on these pages is read from the chain. <a href={AUDIT_URL} className="underline underline-offset-4">You can {AUDIT_LABEL}</a>.</p>
          <p className="mt-1">{chain.name}</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <Shell><Outlet /></Shell>
    </Providers>
  );
}
```

Import `StageBarContainer` from `./components/stage/stage-bar-container`, `AUDIT_LABEL`, `AUDIT_URL` from `./lib/copy`. Move the round picker and `Connections` JSX into the `toolbar` div exactly as they are today. Remove the now-unused `.site-header`, `.header-inner`, `.brand`, `.main-nav`, `.skip-link`, `.workspace` rules from `app/app.css`; keep every rule the proposals, submit, and setup screens still use.

In `app/routes/proposals.tsx`, `submit.tsx`, and `setup.tsx` (through the board), replace the all-caps `.eyebrow` texts with sentence case ("The proposal board", "The organizer's desk", "Submissions", "N submissions") and change `.eyebrow` in `app.css` to `font-size: var(--text-sm); color: var(--muted); letter-spacing: 0;`. The `h1` markup with `<em>` stays.

- [ ] **Step 5: Run the shell test, the suite, the type check, and the build**

Run: `deno run -A npm:vitest run test/shell.test.tsx && deno task test && deno task typecheck && deno task build`
Expected: 1 pass; suite 55 pass; typecheck clean; build succeeds and `build/client/index.html` exists.

- [ ] **Step 6: Update `web/README.md` routes**

Replace the "Open `http://localhost:5174/submit`" sentence with: "Open `http://localhost:5174/` for the round page (`/project/:id` for one project, `/proposals` for the proposals board, `/submit` to submit, `/setup` for the organizer). The stage bar under the header shows where the round is on every page." Add `VITE_ROUND_NAME`, `VITE_REPO_URL`, `VITE_CLOSE_CHUNK`, and `VITE_API_URL` (all optional) to `.env.example` with one-line comments.

- [ ] **Step 7: Commit**

```bash
git add -A app test README.md .env.example
git commit -m "Restyle the shell in the brand look, put the stage bar on every route, and move the proposals board to /proposals"
```

---

### Task 8: Prerender and meta for the round and project pages

**Files:**
- Create: `web/app/lib/build-chain.ts`, `web/app/lib/meta.ts`
- Modify: `web/react-router.config.ts`, `web/app/routes/round.tsx` (add `loader`, `clientLoader`, `meta`), `web/app/routes/project.tsx` (same)
- Test: `web/test/meta.test.ts`, `web/test/build-chain.test.ts`

**Interfaces:**
- Produces: `projectIds(transport?): Promise<number[]>`, `projectFacts(id, transport?, fetchFn?): Promise<ProjectMetaData>`, `roundFacts(transport?): Promise<RoundMetaData>`; `projectMetaTags(data: ProjectMetaData | null, id: number, siteUrl: string)`, `roundMetaTags(data: RoundMetaData | null, siteUrl: string)`.

- [ ] **Step 1: Write the failing meta tests `web/test/meta.test.ts`**

```ts
import { expect, test } from "vitest";
import { projectMetaTags, roundMetaTags } from "../app/lib/meta";

test("project meta uses the pitch title, names the cost, and sets a canonical URL", () => {
  const tags = projectMetaTags({ title: "Formal audit of the tally", cost: "4000000000", decimals: 6, symbol: "USDC" }, 3, "https://ranked.example");
  expect(tags).toContainEqual({ title: "Formal audit of the tally · RankedShares" });
  expect(tags).toContainEqual({ property: "og:title", content: "Formal audit of the tally" });
  expect(tags).toContainEqual({ name: "description", content: "A project asking for 4,000 USDC in a RankedShares funding round." });
  expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://ranked.example/project/3" });
});

test("project meta without data falls back to the id", () => {
  expect(projectMetaTags(null, 3, "https://ranked.example")).toContainEqual({ property: "og:title", content: "Project 3" });
});

test("round meta names the round and the deadline", () => {
  const tags = roundMetaTags({ name: "Autumn grants", votingDeadline: 1_700_003_600 }, "https://ranked.example");
  expect(tags).toContainEqual({ property: "og:title", content: "Autumn grants" });
  expect(tags.find((t) => "name" in t && t.name === "description")?.content).toMatch(/Voting closes on /);
  expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://ranked.example/" });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run test/meta.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `web/app/lib/meta.ts`**

```ts
/** Meta tags for prerendered pages so shared links unfurl (S5.11, S5.12). */
import { formatAmount, formatDateTime } from "./format";

export interface ProjectMetaData {
  title: string | null;
  cost: string;
  decimals: number;
  symbol: string;
}
export interface RoundMetaData {
  name: string;
  votingDeadline: number;
}
type Tag = { title: string } | { name: string; content: string } | { property: string; content: string } | { tagName: "link"; rel: string; href: string };

export function projectMetaTags(data: ProjectMetaData | null, id: number, siteUrl: string): Tag[] {
  const name = data?.title ?? `Project ${id}`;
  const description = data
    ? `A project asking for ${formatAmount(data.cost, data.decimals).shown} ${data.symbol} in a RankedShares funding round.`
    : "A project in a RankedShares funding round.";
  return [
    { title: `${name} · RankedShares` },
    { property: "og:title", content: name },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { tagName: "link", rel: "canonical", href: `${siteUrl.replace(/\/+$/, "")}/project/${id}` },
  ];
}

export function roundMetaTags(data: RoundMetaData | null, siteUrl: string): Tag[] {
  const name = data?.name ?? "RankedShares round";
  const description = data
    ? `A live RankedShares funding round. Voting closes on ${formatDateTime(data.votingDeadline)}.`
    : "A RankedShares funding round.";
  return [
    { title: `${name} · RankedShares` },
    { property: "og:title", content: name },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { tagName: "link", rel: "canonical", href: `${siteUrl.replace(/\/+$/, "")}/` },
  ];
}
```

- [ ] **Step 4: Write the failing build-chain test `web/test/build-chain.test.ts`**

```ts
import { expect, test } from "vitest";
import { custom, decodeFunctionData, encodeFunctionResult, parseAbi, toHex } from "viem";
import { projectFacts, projectIds, roundFacts } from "../app/lib/build-chain";

const abi = parseAbi([
  "function projectCount() view returns (uint256)",
  "function cost(uint256) view returns (uint256)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function votingDeadline() view returns (uint64)",
  "function token() view returns (address)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const handlers: Record<string, (args: readonly unknown[]) => unknown> = {
  projectCount: () => 2n,
  cost: ([id]) => (Number(id) === 0 ? 4_000_000_000n : 2_500_000_000n),
  contentRefOf: ([id]) => (Number(id) === 0 ? "0x" + "ab".repeat(32) : "0x" + "00".repeat(32)),
  votingDeadline: () => 1_700_003_600n,
  token: () => TOKEN,
  symbol: () => "USDC",
  decimals: () => 6,
};
const transport = custom({
  async request({ method, params }: { method: string; params?: unknown[] }) {
    if (method === "eth_chainId") return toHex(31337);
    if (method !== "eth_call") throw new Error(method);
    const [{ data }] = params as [{ data: `0x${string}` }];
    const { functionName, args } = decodeFunctionData({ abi, data });
    return encodeFunctionResult({ abi, functionName, result: handlers[functionName](args ?? []) as never });
  },
});
const cfg = { rpc: "http://fake", pool: POOL as `0x${string}` };
const fetchTitle = (async () => new Response(new TextEncoder().encode(JSON.stringify({ version: 1, title: "Audit", body: "", attachments: [] })))) as unknown as typeof fetch;

test("projectIds reads the count", async () => {
  expect(await projectIds(cfg, transport)).toEqual([0, 1]);
});

test("projectFacts reads cost, token, and the title through the gateway", async () => {
  expect(await projectFacts(0, cfg, transport, "http://bee", fetchTitle)).toEqual({ title: "Audit", cost: "4000000000", decimals: 6, symbol: "USDC" });
  expect(await projectFacts(1, cfg, transport, "http://bee", fetchTitle)).toEqual({ title: null, cost: "2500000000", decimals: 6, symbol: "USDC" });
});

test("roundFacts reads the deadline", async () => {
  expect(await roundFacts(cfg, transport, "Autumn grants")).toEqual({ name: "Autumn grants", votingDeadline: 1_700_003_600 });
});
```

- [ ] **Step 5: Write `web/app/lib/build-chain.ts`**

```ts
/** Build-time chain reads for prerendering (react-router.config.ts and the
 * routes' loaders). Runs under Node during `deno task build`; the browser
 * never imports the loaders because the routes also define clientLoader. */
import { type Address, createPublicClient, http, isAddress, parseAbi, type Transport } from "viem";
import type { ProjectMetaData, RoundMetaData } from "./meta";

const abi = parseAbi([
  "function projectCount() view returns (uint256)",
  "function cost(uint256) view returns (uint256)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function votingDeadline() view returns (uint64)",
  "function token() view returns (address)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface BuildPool {
  rpc: string;
  pool: Address;
}

function env(name: string): string | undefined {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return fromProcess || fromVite || undefined;
}

/** null when VITE_POOL_ADDRESS is unset: the build then prerenders only the fixed routes. */
export function buildPool(): BuildPool | null {
  const pool = env("VITE_POOL_ADDRESS");
  if (!pool || !isAddress(pool)) return null;
  return { rpc: env("VITE_RPC_URL") || "http://127.0.0.1:8545", pool };
}

const client = (cfg: BuildPool, transport?: Transport) =>
  createPublicClient({ transport: transport ?? http(cfg.rpc, { timeout: 5_000 }) });

export async function projectIds(cfg: BuildPool, transport?: Transport): Promise<number[]> {
  const n = await client(cfg, transport).readContract({ address: cfg.pool, abi, functionName: "projectCount" });
  return Array.from({ length: Number(n) }, (_, i) => i);
}

async function titleOf(ref: string, beeUrl: string | undefined, fetchFn: typeof fetch): Promise<string | null> {
  if (!beeUrl || /^0x0{64}$/.test(ref)) return null;
  try {
    const res = await fetchFn(`${beeUrl.replace(/\/+$/, "")}/bytes/${ref.slice(2)}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))) as { title?: unknown };
    return typeof json.title === "string" ? json.title : null;
  } catch {
    return null;
  }
}

export async function projectFacts(
  id: number,
  cfg: BuildPool,
  transport?: Transport,
  beeUrl: string | undefined = env("VITE_BEE_URL"),
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMetaData> {
  const c = client(cfg, transport);
  const [cost, ref, token] = await Promise.all([
    c.readContract({ address: cfg.pool, abi, functionName: "cost", args: [BigInt(id)] }),
    c.readContract({ address: cfg.pool, abi, functionName: "contentRefOf", args: [BigInt(id)] }),
    c.readContract({ address: cfg.pool, abi, functionName: "token" }),
  ]);
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: token, abi, functionName: "symbol" }).catch(() => "tokens"),
    c.readContract({ address: token, abi, functionName: "decimals" }),
  ]);
  return { title: await titleOf(ref, beeUrl, fetchFn), cost: cost.toString(), decimals: Number(decimals), symbol };
}

export async function roundFacts(cfg: BuildPool, transport?: Transport, name = env("VITE_ROUND_NAME") || "RankedShares round"): Promise<RoundMetaData> {
  const deadline = await client(cfg, transport).readContract({ address: cfg.pool, abi, functionName: "votingDeadline" });
  return { name, votingDeadline: Number(deadline) };
}
```

- [ ] **Step 6: Run both test files**

Run: `deno run -A npm:vitest run test/meta.test.ts test/build-chain.test.ts`
Expected: 6 pass.

- [ ] **Step 7: Wire prerender and the loaders**

Replace `web/react-router.config.ts` with:

```ts
import type { Config } from "@react-router/dev/config";
import { buildPool, projectIds } from "./app/lib/build-chain";

const FIXED = ["/", "/proposals", "/submit", "/setup"];

export default {
  ssr: false,
  async prerender() {
    const cfg = buildPool();
    if (!cfg) {
      console.warn("prerender: VITE_POOL_ADDRESS is not set; project pages are not prerendered");
      return FIXED;
    }
    try {
      const ids = await projectIds(cfg);
      return [...FIXED, ...ids.map((id) => `/project/${id}`)];
    } catch (e) {
      console.warn(`prerender: project pages skipped, chain read failed: ${e instanceof Error ? e.message : String(e)}`);
      return FIXED;
    }
  },
} satisfies Config;
```

In `web/app/routes/project.tsx` add above the component:

```tsx
import type { Route } from "./+types/project";
import { buildPool, projectFacts } from "../lib/build-chain";
import { projectMetaTags } from "../lib/meta";

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || "http://localhost:5174";

/** Build time only (prerender): the meta data for this project. */
export async function loader({ params }: Route.LoaderArgs) {
  const cfg = buildPool();
  if (!cfg) return null;
  try {
    return await projectFacts(Number(params.id), cfg);
  } catch {
    return null;
  }
}
/** In the browser the page reads the API; nothing to load. */
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = false as const;

export function meta({ data, params }: Route.MetaArgs) {
  return projectMetaTags(data ?? null, Number(params.id), SITE_URL);
}
```

In `web/app/routes/round.tsx` add:

```tsx
import type { Route } from "./+types/round";
import { buildPool, roundFacts } from "../lib/build-chain";
import { roundMetaTags } from "../lib/meta";

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || "http://localhost:5174";

export async function loader() {
  const cfg = buildPool();
  if (!cfg) return null;
  try {
    return await roundFacts(cfg);
  } catch {
    return null;
  }
}
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = false as const;
export function meta({ data }: Route.MetaArgs) {
  return roundMetaTags(data ?? null, SITE_URL);
}
```

Run `deno task typecheck` first so `react-router typegen` creates the `+types` files; if `Route.MetaArgs`'s `data` type is `unknown`, cast: `projectMetaTags((data as ProjectMetaData | null) ?? null, …)`.

- [ ] **Step 8: Verify the build without a pool and with Anvil**

Run: `VITE_POOL_ADDRESS= deno task build`
Expected: the warning "prerender: VITE_POOL_ADDRESS is not set" and `build/client/index.html`, `build/client/proposals/index.html`, `build/client/submit/index.html`, `build/client/setup/index.html` exist; `grep -c 'og:title' build/client/index.html` prints 1.

Then, with Anvil: start `anvil --port 8545 --silent` in the background, deploy a pool the way `test/workflow.test.tsx` does (or with the root repository's `forge script`), set `VITE_POOL_ADDRESS` to it, run `deno task build`, and check `build/client/project/0/index.html` exists and contains `og:title`. Stop Anvil. If no deploy path is convenient, record in the report that the with-pool build was not exercised and why.

- [ ] **Step 9: Run the suite and type check, then commit**

Run: `deno task test && deno task typecheck`
Expected: 61 pass; clean.

```bash
git add app/lib/build-chain.ts app/lib/meta.ts react-router.config.ts app/routes/round.tsx app/routes/project.tsx test/meta.test.ts test/build-chain.test.ts
git commit -m "Prerender the round and project pages with meta tags that unfurl"
```

---

### Task 9: The rules panel on submit, direct project add on setup, and the docs

**Files:**
- Modify: `web/app/routes/submit.tsx` (rules panel before the form, S1.1), `web/app/routes/setup.tsx` (add-project form, S1.8), `web/app/lib/proposals.ts` (ABI gains `addProject` and `projectCount`), `web/README.md`, `../README.md`, `../docs/design/stories/01-propose-a-project.md`, `05-follow-the-round.md`, `06-close-and-prove.md`, `../docs/design/PROCESS.md`
- Create: `web/app/components/proposals/rules-panel.tsx`, `web/app/components/setup/add-project-form.tsx`
- Test: `web/test/rules-and-setup.test.tsx`

**Interfaces:**
- Consumes: `usePool()` data (`symbol`, `deadline`, `canSubmit`), `RuleLine`, `Field`, `Input`, `Button`, `Notice`, `parseAmount` behaviour from `lib/proposals.ts` (the exact token parser the submit form uses; reuse its function), `assertWallet`, `markMined`.
- Produces: `<RulesPanel symbol deadline />`, `<AddProjectForm symbol decimals disabled busy onSubmit(cost, recipient) error? />`.

- [ ] **Step 1: Write the failing tests `web/test/rules-and-setup.test.tsx`**

```tsx
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RulesPanel } from "../app/components/proposals/rules-panel";
import { AddProjectForm } from "../app/components/setup/add-project-form";

test("RulesPanel states the all-or-nothing rule, the token, and the closing date", () => {
  render(<RulesPanel symbol="USDC" deadline={1_700_003_600} />);
  expect(screen.getByText("Funded at exactly the amount you ask for, or not at all.")).toBeTruthy();
  expect(screen.getByText(/Amounts are in USDC/)).toBeTruthy();
  expect(screen.getByText(/Submissions close on/).textContent).toContain(new Date(1_700_003_600 * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
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
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run test/rules-and-setup.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the components**

`web/app/components/proposals/rules-panel.tsx`:

```tsx
import { formatDateTime, isoDate } from "../../lib/format";
import { RuleLine } from "../ui";

/** The rule before the cost field (S1.1, H9). */
export function RulesPanel({ symbol, deadline }: { symbol: string; deadline: number }) {
  return (
    <section aria-label="How funding works" className="mb-6 flex flex-col gap-3">
      <RuleLine>Funded at exactly the amount you ask for, or not at all.</RuleLine>
      <p className="text-sm text-secondary">Amounts are in {symbol}. Voters rank projects; a project is funded when the weight behind it reaches its cost.</p>
      <p className="text-sm text-secondary">Submissions close on <time dateTime={isoDate(deadline)}>{formatDateTime(deadline)}</time>.</p>
    </section>
  );
}
```

`web/app/components/setup/add-project-form.tsx` (use the same amount parser the submit form uses; find it in `app/lib/proposals.ts` or `app/routes/submit.tsx` and import it rather than re-implementing; the test expects `"4000"` with 6 decimals to give `4000000000n`):

```tsx
import { type FormEvent, useState } from "react";
import { type Address, isAddress } from "viem";
import { parseAmount } from "../../lib/proposals";
import { Button, Field, Input, Notice } from "../ui";

export function AddProjectForm(
  { symbol, decimals, disabled, busy, onSubmit, error }: {
    symbol: string;
    decimals: number;
    disabled: boolean;
    busy: boolean;
    onSubmit: (cost: bigint, recipient: Address) => void;
    error?: string;
  },
) {
  const [cost, setCost] = useState("");
  const [recipient, setRecipient] = useState("");
  const [problem, setProblem] = useState<string>();
  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(undefined);
    let parsed: bigint;
    try {
      parsed = parseAmount(cost, decimals);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Enter a valid amount.");
      return;
    }
    if (!isAddress(recipient)) {
      setProblem("Enter a valid recipient address.");
      return;
    }
    onSubmit(parsed, recipient);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border border-edge bg-surface p-6" aria-label="Add a project">
      <h2 className="font-heading text-xl">Add a project directly</h2>
      <Field id="add-cost" label={`Cost (${symbol})`}>
        <Input id="add-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={disabled} />
      </Field>
      <Field id="add-recipient" label="Recipient address">
        <Input id="add-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={disabled} />
      </Field>
      {(problem || error) && <Notice error>{problem ?? error}</Notice>}
      <Button type="submit" disabled={disabled || busy}>{busy ? "Adding…" : "Add project"}</Button>
    </form>
  );
}
```

If `parseAmount` does not exist under that name, use the submit form's exact parser function (search `app/lib/proposals.ts` and `app/routes/submit.tsx` for the function that turns the amount string into a bigint with the token's decimals) and export it from `app/lib/proposals.ts`.

- [ ] **Step 4: Wire the panel and the form**

In `web/app/routes/submit.tsx`, render `<RulesPanel symbol={round.data.symbol} deadline={Number(round.data.deadline)} />` immediately before the `<SubmitForm …>` element (inside the same `section`), so the panel precedes the cost field in document order.

In `web/app/lib/proposals.ts` add to the ABI: `"function addProject(uint256 cost, address recipient) returns (uint256)"` and `"function projectCount() view returns (uint256)"`.

Rewrite `web/app/routes/setup.tsx`:

```tsx
import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { AddProjectForm } from "../components/setup/add-project-form";
import { Notice } from "../components/ui";
import { useRound } from "../context/providers";
import { usePool } from "../hooks/use-pool";
import { errorMessage, proposalAbi } from "../lib/proposals";
import { assertWallet } from "../lib/transactions";
import { ProposalBoard } from "./proposals";

export default function SetupPage() {
  const { pool, markMined } = useRound();
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const round = usePool();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<string>();
  const owner = !!address && !!round.data && address.toLowerCase() === round.data.owner.toLowerCase();

  async function addProject(cost: bigint, recipient: `0x${string}`) {
    if (!wallet || !publicClient || !pool) return;
    setBusy(true);
    setError(undefined);
    setAdded(undefined);
    try {
      await assertWallet(publicClient, wallet, wallet.account!.address);
      const hash = await wallet.writeContract({ address: pool, abi: proposalAbi, functionName: "addProject", args: [cost, recipient], account: wallet.account!, chain: wallet.chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      markMined(Number(receipt.blockNumber));
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
      setAdded("Project added.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {round.data && owner && round.data.canSubmit && (
        <div className="mb-8">
          <AddProjectForm symbol={round.data.symbol} decimals={round.data.decimals} disabled={busy} busy={busy} onSubmit={addProject} error={error} />
          {added && <Notice>{added}</Notice>}
        </div>
      )}
      <ProposalBoard review />
    </>
  );
}
```

Match `assertWallet`'s real signature as in Task 4.

- [ ] **Step 5: Run the tests, the suite, the type check, and the build**

Run: `deno run -A npm:vitest run test/rules-and-setup.test.tsx && deno task test && deno task typecheck && VITE_POOL_ADDRESS= deno task build`
Expected: 3 pass; suite 64 pass; clean; build succeeds. The existing workflow test still passes (the submit page renders the panel above the form).

- [ ] **Step 6: Docs and story statuses**

- In `docs/design/stories/05-follow-the-round.md` set `Status: built` on S5.1 to S5.7 and S5.9 to S5.12; leave S5.8 planned with the note "waits for /vote".
- In `docs/design/stories/06-close-and-prove.md` set `Status: built` on S6.1 to S6.13.
- In `docs/design/stories/01-propose-a-project.md` set `Status: built` on S1.1 and S1.8.
- In `docs/design/PROCESS.md` current state, append: "2026-09-12: first Deliver slice built (round page, project page, stage bar, shell) on branch round-pages; heuristic and accessibility reviews pending."
- In `web/README.md` add a "Round and project pages" section: what `/` and `/project/:id` show, that they read the API, that `VITE_ROUND_NAME`, `VITE_SITE_URL`, `VITE_REPO_URL`, `VITE_CLOSE_CHUNK` shape the copy and links, and that project pages are prerendered when `VITE_POOL_ADDRESS` is set at build time.
- In the root `README.md` "Proposals and Swarm ID" section, add one sentence: "The web app's round page (`/`) and project pages (`/project/:id`) show public commitments, the sealed total, the stage of the round, and the outcome; see `web/README.md`."

- [ ] **Step 7: Commit**

```bash
git add -A app test README.md ../README.md ../docs/design
git commit -m "Add the rules panel before the cost field and direct project add on setup; record the built stories"
```
