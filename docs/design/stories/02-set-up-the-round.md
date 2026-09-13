# Set up the round (activity 2)

Organiser Ona, on `/setup`, with one story landing on `/` for the invitation link. The
pool is deployed from `/deploy` or the runbook's scripts before these stories start;
the deployment form selects the confirmed pool and links to organizer setup.
Tests hypotheses H7 (a checklist, not a wizard)
and H5 (one sentence on who can decrypt, reached through the invitation link). Contract
facts: `addProject` and `openVoting` are owner-only in the Setup phase; `openVoting` is
irreversible; `sponsor` and `sponsorNFT` are open to anyone during the Open phase before
the deadline, so sponsorships are added after opening.

### S2.1 See what the pool has and lacks before opening

- **As a** Organiser Ona
- **I want to** see a checklist of the pool's configuration, with what is set and what is missing
- **so that** I open the round without a mistake I cannot undo
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The organiser opens the setup page of a pool still in Setup
- **Given** a deployed pool in the Setup phase
- **and Given** I am connected with the owner's wallet on the pool's chain
- **and Given** the pool has a token, a deadline, two accepted projects, and no sponsorships
- **When** I open `/setup`
- **Then** the checklist shows the token symbol, the deadline as a date, each project with its cost in the token's units and its recipient, the tallier key state, and "No sponsorships yet" as an unchecked item

### S2.2 Know when the checklist is not mine to act on

- **As a** Organiser Ona
- **I want to** be told when the connected wallet is not the pool owner
- **so that** I do not try owner actions that will revert
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** A non-owner wallet opens the setup page
- **Given** a deployed pool in the Setup phase
- **and Given** I am connected with a wallet that is not the owner
- **When** I open `/setup`
- **Then** the page shows the checklist read-only with the notice "Connect the owner's wallet to change this round" and no accept, open, or sweep buttons

### S2.3 Add an address-list sponsorship

- **As a** Organiser Ona
- **I want to** sponsor a list of member addresses with an amount from the treasury
- **so that** members can vote with the organisation's money
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The organiser sponsors three members
- **Given** the pool is in the Open phase before the deadline
- **and Given** I am connected with a wallet holding at least the amount in the pool's token
- **and Given** the sponsorship form on `/setup` shows the kind "Address list" selected
- **When** I enter three addresses and an amount and press "Sponsor these members"
- **Then** an approve transaction and a `sponsor(amount, members)` transaction are sent in sequence, and the checklist lists the new sponsorship with its id, three seats, and the per-seat amount

### S2.4 Add an NFT sponsorship

- **As a** Organiser Ona
- **I want to** sponsor the holders of an NFT collection
- **so that** every token holder can claim a seat without me listing addresses
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The organiser sponsors a collection with a known supply
- **Given** the pool is in the Open phase before the deadline
- **and Given** I am connected with the owner's wallet holding the amount
- **and Given** the sponsorship form shows the kind "NFT collection" selected with a collection address and seats left at 0 to use the collection's supply
- **When** I press "Sponsor this collection"
- **Then** a `sponsorNFT(amount, nft, 0)` transaction is sent and the checklist lists the sponsorship with the seat count read back from the pool

### S2.5 Add a Uniswap LP sponsorship

- **As a** Organiser Ona
- **I want to** sponsor liquidity providers of a v4 pool
- **so that** LPs earn seats while their liquidity stays
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The organiser sponsors a DAO/USDC v4 pool
- **Given** the pool is in the Open phase before the deadline
- **and Given** I am connected with the owner's wallet holding the amount
- **and Given** the sponsorship form shows the kind "Uniswap LP pool" selected with the v4 pool id, the unit amount, and the band set to unbounded
- **When** I press "Sponsor this pool"
- **Then** a `sponsorLP` transaction is sent and the checklist lists the sponsorship with the unit, the band, and the reference price read from the v4 pool

### S2.6 Review the round before the irreversible open

- **As a** Organiser Ona
- **I want to** see a summary of projects, token, budget so far, and deadline before opening
- **so that** I catch a wrong number before it is locked in
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The organiser presses open on a complete checklist
- **Given** the pool is in the Setup phase with at least one accepted project
- **and Given** I am connected with the owner's wallet
- **and Given** the checklist shows "Open voting" enabled
- **When** I press "Open voting"
- **Then** a confirmation dialog lists the project count, the token symbol, the budget so far, the deadline as a date, and the sentence "Opening cannot be undone", with the buttons "Open voting" and "Not yet"

### S2.7 Open the round

- **As a** Organiser Ona
- **I want to** open voting from the confirmation
- **so that** members can start contributing and voting
- **Release:** R1 | **Tests:** H7, H8 | **Status:** planned
- **Scenario:** The organiser confirms the open
- **Given** the confirmation dialog of S2.6 is showing
- **When** I press "Open voting" in the dialog
- **Then** an `openVoting()` transaction is sent, and after its receipt the stage bar shows "Open" with the deadline date

### S2.8 Refuse to open a round with no project

- **As a** Organiser Ona
- **I want to** be stopped from opening a round that has no accepted project
- **so that** I do not open an empty round
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** The checklist has no accepted project
- **Given** the pool is in the Setup phase with zero projects
- **and Given** I am connected with the owner's wallet
- **When** I open `/setup`
- **Then** the "Open voting" button is disabled and the checklist item "At least one accepted project" is shown as missing

### S2.9 Copy an invitation link per sponsorship

- **As a** Organiser Ona
- **I want to** copy a link for each sponsorship that lands members on their claim screen
- **so that** members reach a ballot in one step without instructions from me
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** The organiser copies the link of an NFT sponsorship
- **Given** the pool is in the Open phase with one NFT sponsorship of id 0
- **and Given** the checklist lists that sponsorship with a "Copy invitation link" button
- **When** I press "Copy invitation link"
- **Then** the clipboard holds a URL to `/join?sponsorship=0` on the site's origin and the button reads "Copied" for two seconds

### S2.10 Invitation link lands on the claim screen

- **As a** Seat-holder Sol
- **I want to** open the sponsor's link and see my seats or a claim action
- **so that** I do not have to find the pool or the sponsorship id myself
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** A member opens the invitation link without a wallet
- **Given** the pool is in the Open phase with sponsorship 0
- **When** I open `/join?sponsorship=0`
- **Then** the page shows the sponsor's name or address, the sponsorship kind, the per-seat amount, and a "Connect wallet to claim" button, with the round page reachable from the stage bar
