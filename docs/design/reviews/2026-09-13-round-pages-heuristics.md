# Round pages heuristic review

Scope: a heuristic evaluation (Nielsen's ten heuristics, Krug's laws, 0-4 severity)
of the `round-pages-spa` branch, read from code only (no browser run). Reviewed:
`app/root.tsx`, `app/components/stage/stage-bar.tsx`, `app/components/round/*`,
`app/components/project/*`, `app/components/ui/*`, `app/routes/round.tsx`,
`app/routes/project.tsx`, and `app/lib/copy.ts`. Walked as a cognitive walkthrough
for the four personas (Dani, Sol, Ona, Pau) against the design system's seven
principles and stories 05 (follow the round) and 06 (close and prove). File paths
are relative to `web/`.

## Findings

| id | heuristic | screen / file:line | finding | severity | proposed story |
|---|---|---|---|---|---|
| F1 | Principle 6 (readable without a wallet); minimalist design | Every route, `app/root.tsx:236-255` (`Connections`, wired into `Shell`) | The header always shows "Connect wallet" and "Connect Swarm ID" on every page, including the public round board, before any content. Principle 6 says a wallet is asked for at the first action that needs it, never before. | 2 | As an anonymous visitor, I want the page to lead with round content rather than connect prompts, so that I can read the round before deciding to connect anything. |
| F2 | Match between system and real world (Nielsen 2); principle 1 | Stage bar, `app/components/stage/stage-bar.tsx:27-29` | The "proposals" and "setup" steps both read "Submissions close on" followed by `votingDeadline`, but the API type only exposes one deadline (the voting/open-stage close). Before the round opens this attaches the wrong meaning to that date and could tell Proposer Pau or Organiser Ona a false submissions deadline. | 3 | As a proposer in the setup stage, I want to see the actual date submissions close, so that I don't trust a date that is really the voting deadline. |
| F3 | Krug: get rid of half the words | Stage bar, "open" step, `app/components/stage/stage-bar.tsx:33` | The detail text reads "Voting closes in {countdown}, voting closes on {date}", repeating "voting closes" twice in one sentence. | 1 | As a donor reading the stage bar, I want one clear sentence about the deadline, so the phrasing doesn't make me re-read it. |
| F4 | Flexibility and efficiency (Nielsen 7); story S5.8 | Project page, `app/routes/project.tsx` and `app/components/project/project-summary.tsx` (whole files) | Story S5.8 calls for a "Rank this project" control that lands on `/vote` with the project preselected. No such control exists anywhere in `project.tsx` or `project-summary.tsx`; the page only shows the summary and pitch. This breaks the proposer's link-sharing goal (S5.8, S5.11): a donor arriving from a shared project link has to navigate to Vote and find the project again. | 3 | As a donor who opened a project via a shared link, I want a "Rank this project" button on the page, so that I can start voting for it immediately. |
| F5 | User control and freedom (Nielsen 3); recognition (6) | Header, `app/root.tsx:68-77` (`connectWallet`) | `connectWallet` always calls `connectAsync` with `connectors[0]`, with no chooser. A donor with more than one wallet extension installed cannot pick which one connects. | 2 | As a donor with multiple wallets installed, I want to choose which one to connect, so that I don't sign with the wrong account. |
| F6 | Krug's Trunk Test (what round is this?) | Header, `app/root.tsx:179-220` (`RoundPicker`) | The round switcher identifies the current round only by a shortened contract address (`{pool.slice(0,10)}…{pool.slice(-6)}`) next to the eyebrow "ROUND". The human-readable round name only appears in the `<h1>` on the round page itself, so every other route's header shows just an address. | 1 | As a visitor on any page, I want the round switcher to show the round's name, so I always know which round I'm looking at without decoding an address. |
| F7 | Visibility of system status (Nielsen 1) | Project page attachments, `app/routes/project.tsx:46-57` and `app/components/project/pitch.tsx:29-35` | Pressing "Download" on a pitch attachment gives no busy or progress feedback while `client.downloadFile` runs; the button stays in its normal state until either the browser's save happens silently or an error notice appears later. | 2 | As a donor downloading a pitch attachment, I want to see that the download is in progress, so I don't think the click did nothing and try again. |
| F8 | Visibility of system status (Nielsen 1) | Round board, `app/components/round/board.tsx:9-17` | For an Arkiv-backed pool, while commitments are "being computed from Arkiv in your browser" the rows already render each project's commitment from the snapshot (often 0), sitting right under the "still computing" note. A scanning donor can read the zero as "nobody has backed this yet" rather than "not loaded yet". | 2 | As a donor checking standings while Arkiv results compute, I want pending amounts shown as pending rather than as zero, so I don't mistake loading for no support. |
| F9 | Match between system and real world (Nielsen 2) | Your ballot, `app/components/round/your-ballot.tsx:16` | The sealed-ballot status uses "in the roster" / "not in the roster yet" without ever expanding what "the roster" is on this screen. It is understandable in context but is an internal term carried straight from the contract/API layer. | 1 | As a seat holder checking my sealed ballot, I want the status to say plainly whether my ballot has been recorded, so "roster" doesn't make me stop and think. |

Severity counts: 4 catastrophic: 0, 3 major: 2 (F2, F4), 2 minor: 4 (F1, F5, F7, F8),
1 cosmetic: 3 (F3, F6, F9), 0 not-a-problem: 0.

## Strengths

- Design principle 1 ("show the state, not the storage") is followed consistently:
  `Money` always shows the formatted amount with the exact value in a `title`
  tooltip (`app/components/ui/money.tsx`), `Address` shows a checksummed, shortened
  value with the full address on hover/copy, and project titles fall back to
  "Project N" rather than showing an empty or numeric id.
- The sealed side is honest and reassuring for Sol: `SealedPanel` states in one
  sentence that "nobody sees how they rank until then, and the result never
  reveals them" (`app/components/round/sealed-panel.tsx:15`), matching principle 3
  and Sol's stated privacy concern in the personas.
- `Outcome` and `copy.ts` keep the finality wording (proven, provisional,
  abandoned) as the exact sentences from the stories, so the three closing
  outcomes in story 06 are implemented word for word.
- `NOT_CAST`, `NO_PITCH`, `PITCH_FAILED`, and `AUDIT_LABEL` are defined once in
  `app/lib/copy.ts` and reused by both the round and project screens, so the
  wording a donor sees for "no ballot" or "no pitch" is identical everywhere.
- The pitch body is rendered as plain, pre-wrapped text and never as HTML
  (`app/components/project/pitch.tsx:26`), matching S5.5's explicit requirement.
- `SupportBar` uses `role="meter"` with a full text `aria-label` carrying both
  amounts (`app/components/ui/support-bar.tsx:20-25`), and `Address`'s copy
  control announces "Address copied" through a screen-reader-only status region.
- The stage bar's current step alone shows its detail (`showDetail`), keeping the
  other six steps quiet, a direct application of principle 7 ("one loud element").

## Needs a rendered check

- F1, F5, F6: whether the header genuinely reads as "quiet chrome" or as clutter,
  and whether the round name is visually prominent enough on non-home routes,
  can only be judged by looking at the rendered header.
- The "closing" stage detail packs a status line, a "Close next batch" button,
  and a possible error notice into one column of a `grid-cols-7` (desktop) /
  `grid-cols-2` (mobile) stage bar (`app/components/stage/stage-bar.tsx:36-48`).
  Whether this wraps awkwardly or crowds its column needs a rendered check at
  both a phone width and desktop width.
- Colour is the only signal on `Badge` tones besides the text label itself, and
  the actual contrast of `border-success`/`text-success` etc. against `bg-info-bg`
  in both light and dark themes needs a rendered contrast check.
- Whether the "Sealed side" aside (`SealedPanel`) and the two-column
  `lg:grid-cols-[2fr_1fr]` round layout stack sensibly at phone width needs a
  rendered check; the code only sets the breakpoint, not the visual result.
- Loading-state timing (skeleton flashes, the "Updated {formatAgo}" refresh after
  a transaction per S5.4) cannot be verified without running the app against a
  live or mocked snapshot poll.
