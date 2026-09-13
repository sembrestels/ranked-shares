# Close and prove (activity 6)

Organiser Ona drives this activity and every persona watches it. The screens are the
stage bar, shown on every route, and the outcome section of the round page at `/`, with
the project page at `/project/:id` reflecting the same finality. The stories test H8:
a stage indicator with the dates that bound it answers "what is happening" without
narration. Contract facts are from `README.md`: after the deadline anyone calls
`close(maxVoters)` until `closed()` is true; the tally then lands through the proof
path or the on-chain tally; `finality()` says whether the pool ended proven,
provisional, or abandoned; `fundedProjects()` lists funded ids in order.

### S6.1 The stage bar names the current stage everywhere

- **As a** Donor Dani
- **I want to** see which stage the round is in on every screen
- **so that** I never have to ask in chat what is happening
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** any route renders the stage bar with the current stage marked
- **Given** the pool is in the open phase with a deadline in the future
- **and Given** I open any route of the app
- **When** the page renders
- **Then** the stage bar lists proposals, setup, open, closing, proving, proven, and paid, marks "open" as current, and shows the deadline as a date and time

### S6.2 The stage bar shows what bounds the stage

- **As a** Organiser Ona
- **I want to** see the date that ends the current stage
- **so that** I can tell members when the next thing happens
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the current stage carries its bounding date
- **Given** the pool is open and `votingDeadline` is set
- **and Given** the stage bar is rendered
- **When** I read the current stage
- **Then** the stage bar shows "voting closes on" followed by the deadline in the viewer's local time zone

### S6.3 Closing shows the roster progress

- **As a** Organiser Ona
- **I want to** see how much of the voter roster has been closed
- **so that** I know whether the close step is finished or stuck
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the closing stage renders roster progress from chain state
- **Given** the deadline has passed and `closed()` is false
- **and Given** the API reports the number of voters processed and the total voter count
- **When** the stage bar renders
- **Then** it marks "closing" as current and shows "N of M voters closed" with the numbers from the API

### S6.4 Anyone can close the roster in chunks

- **As a** Organiser Ona
- **I want to** press one button to close the next chunk of the roster
- **so that** the round moves on without the runbook
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the close action sends one `close(maxVoters)` transaction
- **Given** the deadline has passed and `closed()` is false
- **and Given** my wallet is connected on the pool's chain
- **and Given** the stage bar shows a "close next batch" button
- **When** I press "close next batch" and confirm in my wallet
- **Then** a `close` transaction with the configured chunk size is sent and, once mined, the roster progress count increases

### S6.5 The close button disappears when closing is done

- **As a** Organiser Ona
- **I want to** stop seeing the close action once the roster is closed
- **so that** I do not send a transaction that would revert
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** a closed roster hides the action
- **Given** `closed()` is true
- **When** the stage bar renders
- **Then** no "close next batch" button is rendered and "closing" is shown as complete

### S6.6 Proving shows the operator's progress as reported

- **As a** Organiser Ona
- **I want to** see how far the tally and proof have got
- **so that** I know the operator is working and I do not chase them
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the proving stage renders progress from chain events
- **Given** `closed()` is true and `finality()` is not yet set
- **and Given** the API reports the tally steps or proof batches accepted so far
- **When** the stage bar renders
- **Then** it marks "proving" as current and shows the count of accepted steps, or "waiting for the first proof" when none have landed

### S6.7 The grace timeline shows the dates

- **As a** Donor Dani
- **I want to** see when the round can be accepted provisionally or abandoned
- **so that** I know the round cannot hang forever
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the proving stage lists both grace deadlines
- **Given** the pool is in the proving stage
- **and Given** the API reports the `proofGrace` and `abandonGrace` end times
- **When** the stage bar renders
- **Then** it shows "provisional result possible from" and "abandonment possible from" each followed by a date and time in the viewer's local time zone

### S6.8 The outcome lists funded projects in order

- **As a** Donor Dani
- **I want to** see which projects were funded and in what order
- **so that** I know where the round's money went
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the round page renders the funded set once finality is set
- **Given** `finality()` is set
- **and Given** `fundedProjects()` returns a non-empty list
- **When** I open `/`
- **Then** the outcome section lists each funded project by name and cost in the order returned, and every other project is listed as "not funded"

### S6.9 Finality is written in words

- **As a** Seat-holder Sol
- **I want to** read what kind of result this is
- **so that** I can trust it without decoding a number
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** a proven pool is described in plain words
- **Given** `finality()` reports proven
- **When** I open `/`
- **Then** the outcome section shows "Proven" and the sentence "the sealed ballots were proven against their commitments and the public ballots can be replayed from chain data"

### S6.10 The outcome links to the audit path

- **As a** Donor Dani
- **I want to** open the instructions for checking the result myself
- **so that** I do not have to trust the operator
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** the proven outcome carries an audit link
- **Given** `finality()` reports proven
- **and Given** the outcome section is rendered
- **When** I look for a way to verify the result
- **Then** a link labelled "check this result yourself" points to the repository's audit instructions

### S6.11 A provisional outcome says what it means

- **As a** Organiser Ona
- **I want to** see that the result is provisional and why
- **so that** I can explain it to members honestly
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** an accepted provisional result is labelled and explained
- **Given** `finality()` reports provisional
- **When** I open `/`
- **Then** the outcome section shows "Provisional" and the sentence "the operator's report was accepted after the proof grace period without a proof; the funded set stands"

### S6.12 An abandoned outcome says what happens next

- **As a** Organiser Ona
- **I want to** see that the round was abandoned and what follows
- **so that** I know the money can be swept back
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** an abandoned pool is labelled and explained
- **Given** `finality()` reports abandoned
- **When** I open `/`
- **Then** the outcome section shows "Abandoned" and the sentence "no result arrived before the abandonment deadline; no project is funded and the organiser can sweep the pool"

### S6.13 The project page shows its own outcome

- **As a** Proposer Pau
- **I want to** see on my project's page whether it was funded
- **so that** I learn the result where I already look
- **Release:** R1 | **Tests:** H8 | **Status:** built
- **Scenario:** a funded project's page states the result
- **Given** `finality()` is set
- **and Given** the project is in `fundedProjects()`
- **When** I open `/project/:id`
- **Then** the page shows "Funded" next to the cost and the finality word from the round page
