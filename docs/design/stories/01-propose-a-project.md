# Propose a project (activity 1)

Proposer Pau submits and, while pending, edits; Organiser Ona reviews. Screens: `/submit`,
`/` (the proposals board), `/setup` (review). Hypotheses H9 and H10. Most of this
activity landed on master on 2026-09-12 in `web/` (commit b5cef88): uploads through
Swarm ID, review, and revision editing. Those stories are recorded as built so the
acceptance tests have a home; the two planned ones are what R1 still needs.

### S1.1 Read the round's rules before writing the proposal

- **As a** Proposer Pau
- **I want to** see the funding rule, the token, and the proposal deadline before I fill
  in the form
- **so that** I set a cost I can live with, knowing a project is funded at exactly that
  amount or not at all
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** the rules panel is on the submit page above the cost field
- **Given** I am on `/submit` for a round in the proposals stage
- **and Given** the page shows a panel with "Funded at exactly the amount you ask for,
  or not at all", the token symbol, and the date submissions close
- **When** I scroll to the cost field
- **Then** the panel is above the field and its text is present in the document before
  the cost input in reading order

### S1.2 Submit a proposal with its content on Swarm

- **As a** Proposer Pau
- **I want to** write the pitch, attach files, name the cost and the recipient, and
  submit it in one flow
- **so that** the round lists my project with exactly what I wrote and the address I
  chose
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** upload then transaction
- **Given** I am on `/submit` with a wallet connected on the round's chain and a Swarm
  ID that can upload
- **and Given** the form has a title, body, attachments, a cost in the token's units,
  and a recipient address, all filled in validly
- **When** I choose "Upload and submit" and confirm the wallet transaction
- **Then** the pool emits `Proposed` with the manifest reference, the cost and the
  recipient I entered, and the page shows "Proposal received" with those three values

### S1.3 See the proposal's status after submitting

- **As a** Proposer Pau
- **I want to** see whether my proposal is pending, accepted, or rejected
- **so that** I know whether to wait, campaign, or move on
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** status badge on the board
- **Given** I have submitted a proposal
- **and Given** I open `/` for the same round
- **When** the board loads
- **Then** my proposal's card shows one of "Pending review", "Accepted", "Rejected"
  matching `proposals(id).status`

### S1.4 Verify the listed cost and recipient

- **As a** Proposer Pau
- **I want to** compare the cost and recipient the chain holds with what I submitted
- **so that** a typo cannot send the funds to the wrong address
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** the card shows the on-chain terms
- **Given** my proposal is on the board
- **When** I open its card
- **Then** the cost in the token's units and the full recipient address are shown from
  the chain, not from local state

### S1.5 Edit a pending proposal

- **As a** Proposer Pau
- **I want to** change the text, files, cost, or recipient while the proposal is pending
- **so that** I can fix a mistake before the organiser decides
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** a new revision from the editor
- **Given** my proposal is pending and I am its original proposer
- **and Given** I chose "Edit proposal" on its card and changed the cost
- **When** I choose "Save revision" and confirm the transaction
- **Then** `proposalRevision(id)` increments by one and the card shows the new cost
  and "Revision 2"

### S1.6 Refuse a stale edit

- **As a** Proposer Pau
- **I want to** be told when someone else saved a revision before mine
- **so that** I do not overwrite their change without seeing it
- **Release:** R1 | **Tests:** H9 | **Status:** built
- **Scenario:** concurrent edit conflict
- **Given** I opened the editor at revision 1
- **and Given** the organiser saved revision 2 meanwhile
- **When** I choose "Save revision"
- **Then** the transaction reverts, my draft stays in the form, and a notice offers
  "Discard edits and load latest revision"

### S1.7 Review pending proposals

- **As an** Organiser Ona
- **I want to** read each pending proposal with its pitch and attachments and accept or
  reject it
- **so that** only the projects I stand behind enter the round
- **Release:** R1 | **Tests:** H7 | **Status:** built
- **Scenario:** accept from the review screen
- **Given** I am on `/setup` with the pool owner's wallet connected
- **and Given** a pending proposal's card shows its text, attachments, cost, recipient,
  and revision
- **When** I choose "Accept" and confirm the transaction
- **Then** the pool emits `ProposalAccepted` with a new project id and the card's status
  becomes "Accepted"

### S1.8 Add a project directly

- **As an** Organiser Ona
- **I want to** add a project with a cost and recipient without a proposal
- **so that** a round that takes no submissions can still be set up from the frontend
- **Release:** R1 | **Tests:** H7 | **Status:** built
- **Scenario:** direct add from setup
- **Given** I am on `/setup` with the owner's wallet and the pool in the setup stage
- **and Given** the "Add a project" form has a cost and a recipient filled in validly
- **When** I choose "Add project" and confirm the transaction
- **Then** `ProjectAdded` is emitted with that cost and recipient and the setup
  checklist's project count increases by one
