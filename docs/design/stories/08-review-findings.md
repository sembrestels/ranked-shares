# Review findings (activity 5 and 6 follow-ups)

Stories from the heuristic and accessibility reviews of the round pages
(`docs/design/reviews/2026-09-13-round-pages-heuristics.md` and
`2026-09-13-round-pages-accessibility.md`). Findings fixed in the slice's final fix
wave (F2, F3, A1, A2, A8) and the one ruled out of scope (F4, which is S5.8) are not
repeated here. Personas: Dani, Sol, Pau; screens `/`, `/project/:id`, the shell.

### S8.1 Ask for a wallet at the first action that needs it (F1)

- **As a** Donor Dani arriving by link
- **I want to** read the round without being asked to connect anything
- **so that** the page feels public and I connect only when I act
- **Release:** R1 | **Tests:** H4 | **Status:** planned
- **Scenario:** the connect controls stay out of the way on read-only screens
- **Given** I open `/` with no wallet connected
- **When** the page renders
- **Then** the header shows one "Connect" affordance folded into the toolbar and no Swarm ID prompt until I open a screen that uploads or downloads

### S8.2 Choose which wallet connects (F5)

- **As a** Donor Dani with more than one wallet extension
- **I want to** pick the wallet to connect
- **so that** I never sign with the wrong account
- **Release:** R1 | **Tests:** H3 | **Status:** planned
- **Scenario:** several injected wallets are announced
- **Given** two wallets announce themselves through EIP-6963
- **When** I press "Connect wallet"
- **Then** a picker lists both by name and connects the one I choose

### S8.3 Name the round in the header (F6)

- **As a** Donor Dani on any screen
- **I want to** see which round I am looking at by its name, not only its address
- **so that** I can tell rounds apart when I follow more than one
- **Release:** R1 | **Tests:** H8 | **Status:** planned
- **Scenario:** the round picker shows the round's name
- **Given** the round name is configured
- **When** any route renders the header
- **Then** the round picker shows the name with the shortened address beneath it

### S8.4 Show download progress (F7)

- **As a** Donor Dani downloading an attachment
- **I want to** see that the download is in progress
- **so that** I do not press the control twice or assume it failed
- **Release:** R1 | **Tests:** H10 | **Status:** planned
- **Scenario:** a large attachment takes seconds to fetch
- **Given** I am on `/project/3` and press "Download plan.pdf"
- **When** the fetch is running
- **Then** the control reads "Downloading…" and is disabled until the file is saved or an error is shown

### S8.5 Do not show zeros while Arkiv results are computing (F8)

- **As a** Donor Dani on an Arkiv round
- **I want to** see a placeholder, not a zero, for each commitment while the browser computes them
- **so that** I never read "nobody backed this" when the numbers are simply not in yet
- **Release:** R1 | **Tests:** H4 | **Status:** planned
- **Scenario:** first load of an Arkiv pool's round page
- **Given** the snapshot says `ballots: "arkiv"` and the live results have not resolved
- **When** the board renders
- **Then** each commitment cell shows a skeleton and the support bar is hidden until the live results arrive

### S8.6 Say what the roster is (F9)

- **As a** Seat-holder Sol reading my ballot status
- **I want to** understand "in the roster" without knowing the contract
- **so that** the status reassures rather than puzzles me
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** the sealed status explains the term once
- **Given** my sealed ballot is in the roster
- **When** the status renders
- **Then** it reads "Your ballot: sealed and registered for counting" with "roster" used, if at all, after that explanation

### S8.7 Info badge contrast (A3)

- **As a** Donor Dani with low vision
- **I want to** read the pending and provisional badges
- **so that** the outcome's state is legible
- **Release:** R1 | **Tests:** | **Status:** planned
- **Scenario:** the info tone reaches 4.5:1
- **Given** the badge tone "info" is rendered on its background
- **When** the contrast is measured in a browser
- **Then** it is at least 4.5:1, with the token adjusted if the computed mix falls short

### S8.8 Copy control target size (A4)

- **As a** Proposer Pau on a phone
- **I want to** tap "Copy" next to the recipient address reliably
- **so that** I can verify the listed address without a mis-tap
- **Release:** R1 | **Tests:** H10 | **Status:** planned
- **Scenario:** the control meets the minimum target size
- **Given** the address is rendered with the copy control
- **When** the control's box is measured
- **Then** it is at least 24 by 24 CSS pixels

### S8.9 Announce loading to screen readers (A5)

- **As a** Donor Dani using a screen reader
- **I want to** hear that the round is loading
- **so that** silence does not read as an empty page
- **Release:** R1 | **Tests:** H8 | **Status:** planned
- **Scenario:** a loading skeleton has a status announcement
- **Given** the round page is fetching its first snapshot
- **When** the skeleton renders
- **Then** a `role="status"` element announces "Loading the round"

### S8.10 Respect reduced motion in the skeleton (A6)

- **As a** Donor Dani who has asked for reduced motion
- **I want to** see a still placeholder instead of a pulsing one
- **so that** the page respects my setting
- **Release:** R1 | **Tests:** | **Status:** planned
- **Scenario:** the pulse is disabled under reduced motion
- **Given** the browser reports `prefers-reduced-motion: reduce`
- **When** a skeleton renders
- **Then** it does not animate

### S8.11 Show the deadline next to the countdown (A7)

- **As a** Donor Dani on a phone
- **I want to** see the exact deadline, not only a countdown
- **so that** I can plan without hovering for a tooltip
- **Release:** R1 | **Tests:** H4 | **Status:** planned
- **Scenario:** the countdown is followed by the date
- **Given** the open step of the stage bar renders
- **When** I read it without a pointer
- **Then** the deadline's date and time are visible text, not only a `title`

### S8.12 Keep the ballot panel and the stage bar on the same clock (final review)

- **As a** Seat-holder Sol between the deadline and the close transaction
- **I want to** see that voting has closed in the ballot panel as well as in the stage bar
- **so that** I am not offered a replacement the contract will refuse
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** the deadline has passed but nobody has called close yet
- **Given** the snapshot's phase is still "open" and its `at` is past `votingDeadline`
- **When** the round page renders
- **Then** the ballot panel omits "replaceable until" and the "Rank the projects" link, matching the stage bar's "Voting closed on"

### S8.13 State roster membership only when it is true (final review)

- **As a** Seat-holder Sol whose sealed ballot is not yet in the roster
- **I want to** see "not registered yet" rather than "in the roster"
- **so that** the status never claims what the API denies
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** a sealed ballot with `inRoster: false` after the deadline
- **Given** the voter response says `sealed: true` and `inRoster: false`
- **When** the ballot panel renders
- **Then** it reads "Your ballot: sealed, not registered yet"
