# Join with money or seats (activity 3)

Donor Dani and Seat-holder Sol, arriving on `/` or `/project/:id` from a shared link,
then on `/join` to contribute or claim seats, and on `/positions` for the LP variant of
Sol. Tests H4 (the board keeps the round alive), H10 (the project page is the link
people share), H3 (one step to contribute), H5 (one sentence on who can decrypt), and
H12 (seats that accrue can be understood from a counter). Contract facts: `contribute`
needs a token approval first and deposits are never withdrawn; address-list seats are
granted at sponsorship time and need no claim call; NFT seats are claimed with
`claimSeat(sponsorshipId, tokenId)`; LP seats are claimed by subscribing the position
and accrue while the liquidity stays.

### S3.1 See the round without a wallet

- **As a** Donor Dani
- **I want to** open a shared link and see the round without connecting anything
- **so that** I can decide whether to take part before signing anything
- **Release:** R1 | **Tests:** H4, H10 | **Status:** planned
- **Scenario:** A donor opens the round page from a chat link
- **Given** a pool in the Open phase with three projects and one contribution
- **and Given** I have no wallet connected
- **When** I open `/`
- **Then** the page shows the stage bar at "Open" with the deadline date, the budget so far in the token's units, the three projects with cost and public commitments, and a "Contribute" link to `/join`

### S3.2 See a project from its shared link

- **As a** Donor Dani
- **I want to** open a project's link and see what it is and how it stands
- **so that** I can rank it knowing what I am backing
- **Release:** R1 | **Tests:** H10 | **Status:** planned
- **Scenario:** A donor opens a project page from a proposer's post
- **Given** a pool in the Open phase whose project 1 was accepted from a proposal with a Swarm reference
- **and Given** I have no wallet connected
- **When** I open `/project/1`
- **Then** the page shows the project's title and text resolved from its reference, its cost, its recipient, its public support, and a "Rank this project" link to `/vote?project=1`

### S3.3 Connect a wallet

- **As a** Donor Dani
- **I want to** connect my browser wallet from the page I am on
- **so that** I can contribute without leaving the round
- **Release:** R1 | **Tests:** none | **Status:** planned
- **Scenario:** A donor connects an injected wallet on the right chain
- **Given** I am on `/join` with a browser wallet already on the pool's chain
- **When** I press "Connect wallet" and approve the connection in the wallet
- **Then** the header shows my short address and the pool's chain name, and the contribute form is enabled

### S3.4 Switch to the pool's chain

- **As a** Donor Dani
- **I want to** be told when my wallet is on the wrong network and be switched with one press
- **so that** my first transaction does not fail for a reason I cannot see
- **Release:** R1 | **Tests:** none | **Status:** planned
- **Scenario:** A wallet connected on another chain
- **Given** I am on `/join` with a wallet connected on a chain that is not the pool's
- **and Given** the page shows the notice "Your wallet is on another network" with a "Switch to Arc testnet" button
- **When** I press "Switch to Arc testnet" and approve in the wallet
- **Then** the notice disappears and the contribute form is enabled

### S3.5 Read that deposits are final before signing

- **As a** Donor Dani
- **I want to** be told before my first signature that deposits do not come back
- **so that** I am not surprised after the money has moved
- **Release:** R1 | **Tests:** H3 | **Status:** planned
- **Scenario:** A donor enters an amount
- **Given** I am on `/join` connected on the pool's chain with a token balance
- **When** I enter an amount in the contribute form
- **Then** the form shows the sentence "Deposits stay in the pool until the round ends and are never returned" and the button "Contribute", with the note "Two wallet confirmations: one to allow the token, one to deposit"

### S3.6 Contribute as one action

- **As a** Donor Dani
- **I want to** approve and contribute as one action announced up front
- **so that** the second wallet prompt does not feel like something went wrong
- **Release:** R1 | **Tests:** H3 | **Status:** planned
- **Scenario:** A donor contributes with no prior allowance
- **Given** I am on `/join` connected on the pool's chain with a balance and no allowance for the pool
- **and Given** I have entered an amount within my balance
- **When** I press "Contribute" and approve both wallet prompts
- **Then** the page shows the progress "1 of 2: allowing the token" then "2 of 2: depositing", and after the `contribute` receipt shows "Deposited" with the amount

### S3.7 Skip the approval when it already exists

- **As a** Donor Dani
- **I want to** get only one prompt when the pool is already allowed to take my tokens
- **so that** repeat contributions are quick
- **Release:** R1 | **Tests:** H3 | **Status:** planned
- **Scenario:** A donor contributes with a sufficient allowance
- **Given** I am on `/join` connected with an allowance at least equal to the amount entered
- **When** I press "Contribute" and approve the single wallet prompt
- **Then** only a `contribute` transaction is sent and the page shows "Deposited" with the amount

### S3.8 See my weight in the token's units

- **As a** Donor Dani
- **I want to** see my voting weight after contributing
- **so that** I know my money became weight in the round
- **Release:** R1 | **Tests:** H3 | **Status:** planned
- **Scenario:** A donor has just contributed
- **Given** I am on `/join` connected, and the pool's `weightOf` for my address is 500 units of a six-decimal token
- **When** the page refetches after my `contribute` receipt
- **Then** the page shows "Your weight: 500.00 USDC" and a "Rank projects" link to `/vote`

### S3.9 See address-list seats with nothing to do

- **As a** Seat-holder Sol
- **I want to** see that I already hold seats from an address-list sponsorship
- **so that** I do not look for a claim button that does not exist
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** A listed member opens the invitation link
- **Given** the pool is in the Open phase with an address-list sponsorship that names my address with one seat
- **and Given** I am connected with that address on `/join?sponsorship=0`
- **When** the page reads my weight from the pool
- **Then** the page shows "You have 1 seat worth 30.00 USDC. Nothing to claim." and a "Rank projects" link to `/vote`

### S3.10 Claim an NFT seat in one transaction

- **As a** Seat-holder Sol
- **I want to** claim the seat for a token I hold with one press
- **so that** my seat counts without me knowing the sponsorship or token ids
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** A holder claims one token's seat
- **Given** the pool is in the Open phase with an NFT sponsorship 0 whose collection I hold token 7 of
- **and Given** I am connected on `/join?sponsorship=0` and the page lists token 7 as "Claimable"
- **When** I press "Claim seat" next to token 7 and approve in the wallet
- **Then** a `claimSeat(0, 7)` transaction is sent and after its receipt the page shows "You have 1 seat" with the per-seat amount

### S3.11 Say when a seat is already taken

- **As a** Seat-holder Sol
- **I want to** be told when a token's seat is held by someone else
- **so that** I understand why it is not mine to claim
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** A token whose seat a previous holder claimed
- **Given** the pool has NFT sponsorship 0 and token 7's seat is held by another address
- **and Given** I now hold token 7 and am connected on `/join?sponsorship=0`
- **When** the page reads the seat holder for token 7
- **Then** the page lists token 7 as "Held by 0x1234…abcd. Claim it to move the seat to you" with the "Claim seat" button enabled

### S3.12 List my v4 positions with eligibility

- **As a** Seat-holder Sol
- **I want to** see which of my liquidity positions can earn seats and why the others cannot
- **so that** I know what claiming will get me before I sign
- **Release:** R1 | **Tests:** H12 | **Status:** planned
- **Scenario:** An LP with one eligible and one ineligible position
- **Given** the pool has an LP sponsorship for the DAO/USDC v4 pool
- **and Given** I am connected with a wallet holding one position in that pool inside the band and one in another pool
- **When** I open `/positions`
- **Then** the page lists the first position as "Eligible: about 12 seats if held to the deadline" and the second as "Not eligible: different pool"

### S3.13 Claim LP seats in one transaction

- **As a** Seat-holder Sol
- **I want to** claim seats for an eligible position with one press
- **so that** the position starts earning seats now
- **Release:** R1 | **Tests:** H12 | **Status:** planned
- **Scenario:** An LP subscribes an eligible position
- **Given** I am on `/positions` connected, with one eligible position listed
- **When** I press "Claim seats" on that position and approve in the wallet
- **Then** a subscribe transaction for that token id and the pool's sponsorship is sent, and after its receipt the position shows "Accruing"

### S3.14 Understand the accruing counter

- **As a** Seat-holder Sol
- **I want to** see seats so far and the projected total with a plain explanation
- **so that** I understand why the number changes and why claiming early was better
- **Release:** R1 | **Tests:** H12 | **Status:** planned
- **Scenario:** An LP returns to the positions page while accruing
- **Given** I am on `/positions` connected, with a subscribed position and the pool's accrual read for it
- **When** the page reads the accrual
- **Then** the position shows "Seats so far: 4.2. At the deadline: about 12." and the sentence "Seats accrue while the liquidity stays; claiming early earns more."
