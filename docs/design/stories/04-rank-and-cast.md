# Rank and cast (activity 4)

Donor Dani and Seat-holder Sol on `/vote` (rank, choose the mode, cast) and `/ballot`
(the current ballot and its replacement). Tests H1 (ranking without the rulebook), H2
(choosing public or sealed at cast time), H5 (one sentence on who can decrypt), and H6
(the current ballot is visible). Source: R1 tasks of activity 4 in
`docs/design/story-map.md`.

### S4.1 Group proposals into funding tiers

- **As a** Donor Dani
- **I want to** place proposal boxes in Must fund, Should fund, or Nice to have
- **so that** my money follows my preference without my having to learn the ballot encoding
- **Release:** R1 | **Tests:** H1 | **Status:** built
- **Scenario:** a donor with weight places three of four projects
- **Given** I am connected on `/vote` with contributed weight at or above minDirectVote
- **and Given** every project starts under "Unplaced proposals" above the three tier rows
- **When** I drag B to Must fund, A to Should fund, and D to Nice to have
- **Then** each proposal appears once in its tier, C remains unplaced, and the submitted ballot encodes B as 1, A as 2, D as 3, C as 0

### S4.2 Give proposals in the same tier equal priority

- **As a** Donor Dani
- **I want to** mark two projects as equally preferred
- **so that** I do not have to invent an order between projects I value the same
- **Release:** R1 | **Tests:** H1 | **Status:** built
- **Scenario:** a donor ties the highest priority
- **Given** I am on `/vote` with A in Must fund and C in Should fund
- **and Given** the helper text explains that proposals in the same row have equal priority
- **When** I move B into Must fund
- **Then** A and B are tied, the ballot encodes A and B as 1 and C as 3, and horizontal position within a row has no effect

### S4.3 Leave a proposal below the funding tiers

- **As a** Seat-holder Sol
- **I want to** leave a proposal unplaced
- **so that** it ranks below every proposal I placed in a funding tier
- **Release:** R1 | **Tests:** H1 | **Status:** built
- **Scenario:** a seat holder returns a proposal to the starting group
- **Given** I am on `/vote` with A, B, and C in funding tiers
- **When** I select C and activate "Move here" in Unplaced proposals
- **Then** C moves to that group and encodes as 0, tied below placed proposals rather than excluded from funding

### S4.4 Choose public or sealed with one line each

- **As a** Donor Dani
- **I want to** see the two ballot modes side by side before I cast
- **so that** I choose visibility or privacy deliberately and understand what each costs me
- **Release:** R1 | **Tests:** H2 | **Status:** planned
- **Scenario:** a donor with only contributed weight reaches the mode choice
- **Given** I am on `/vote` with at least one project ranked and contributed weight at or above minDirectVote
- **and Given** the page shows two options, "Public and final: everyone sees your ranking and it cannot be changed" and "Sealed and replaceable: encrypted in your browser, replaceable until the deadline"
- **When** I choose "Sealed and replaceable"
- **Then** the cast button reads "Cast sealed ballot" and the public option is shown unselected

### S4.5 Seat weight can only be cast sealed

- **As a** Seat-holder Sol
- **I want to** be told that my seats can only vote sealed
- **so that** I am not left looking for a public option that does not exist for sponsored money
- **Release:** R1 | **Tests:** H2 | **Status:** planned
- **Scenario:** a seat holder with no contributed weight reaches the mode choice
- **Given** I am on `/vote` with seat weight at or above minSealedVote and no contributed weight
- **and Given** at least one project is ranked
- **When** the mode choice renders
- **Then** only "Sealed and replaceable" is offered, with the text "Sponsored seats always vote sealed, so the sponsor cannot see how you ranked."

### S4.6 Confirm that a public ballot is final before signing

- **As a** Donor Dani
- **I want to** confirm that my public ballot cannot be changed before my wallet asks me to sign
- **so that** I never lock in a ranking by accident
- **Release:** R1 | **Tests:** H2 | **Status:** planned
- **Scenario:** a donor casts a public ballot
- **Given** I am on `/vote` with "Public and final" chosen and a ranking of B, A, D
- **and Given** I pressed "Cast public ballot" and a confirmation shows my ranking and the sentence "This ballot is final. You cannot change or replace it."
- **When** I press "Cast final ballot" in the confirmation
- **Then** the wallet is asked to sign a `vote` transaction whose ballot bytes are B 1, A 2, D 3, C 0

### S4.7 Land on the current ballot after a public cast confirms

- **As a** Donor Dani
- **I want to** see my ballot as I ranked it once the transaction confirms
- **so that** I know it counted and what it says
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** the public vote transaction is mined
- **Given** I cast a public ballot from `/vote`
- **and Given** the page shows "Waiting for confirmation" with the transaction hash
- **When** the transaction receipt arrives
- **Then** I am on `/ballot` and it shows my ranking in order, "Public and final", and the block time it was cast

### S4.8 Read who holds the key before casting sealed

- **As a** Seat-holder Sol
- **I want to** read who can open my sealed ballot and when
- **so that** I trust the privacy claim enough to vote honestly
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** a seat holder chooses the sealed mode
- **Given** I am on `/vote` with "Sealed and replaceable" chosen
- **and Given** at least one project is ranked
- **When** the sealed cast panel renders
- **Then** it shows the sentence "Only the tallier's key can open sealed ballots, and it is used once, after the deadline, to count them; nobody, including the sponsor, sees how you ranked."

### S4.9 Encrypt in the browser and cast a sealed ballot

- **As a** Seat-holder Sol
- **I want to** cast my ranking as a sealed ballot without leaving the browser
- **so that** I never need a command line or send my ranking anywhere in the clear
- **Release:** R1 | **Tests:** H5 | **Status:** planned
- **Scenario:** a seat holder casts sealed for the first time
- **Given** I am on `/vote` with "Sealed and replaceable" chosen and a ranking of A, B
- **and Given** the pool's tallier public key is loaded and the page shows "Encrypted on this device before sending"
- **When** I press "Cast sealed ballot"
- **Then** the wallet is asked to sign a `voteSealed` transaction whose ciphertext was produced by the shared secp256k1 module under the domain RankedShares/sealed/secp256k1 for my address and the ranking A 1, B 2, and decrypting it with the test tallier key returns that ranking

### S4.10 See the current ballot and whether it can be replaced

- **As a** Seat-holder Sol
- **I want to** see my current ballot, when it was cast, and whether it is still replaceable
- **so that** I know which ballot counts and how long I have to change it
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** a seat holder returns to the site before the deadline
- **Given** I am connected and have a sealed ballot on chain from the current address
- **and Given** the deadline has not passed
- **When** I open `/ballot`
- **Then** it shows "Your current ballot", the block time it was cast, "Sealed and replaceable until" followed by the deadline, and my ranking from local storage or the text "Ranking kept private; this device did not cast it"

### S4.11 Replace a sealed ballot and be told the old one is discarded

- **As a** Seat-holder Sol
- **I want to** replace my sealed ballot before the deadline
- **so that** I can act on new information without any doubt about which ballot counts
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** a seat holder replaces an existing sealed ballot
- **Given** I am on `/ballot` with a sealed ballot on chain and the deadline not passed
- **and Given** I pressed "Replace ballot", changed the ranking on `/vote`, and a confirmation shows "Your previous ballot is discarded. Only this one counts."
- **When** I press "Cast replacement" in the confirmation
- **Then** the wallet is asked to sign a `voteSealed` transaction with the new ciphertext, and after the receipt `/ballot` shows the new block time with the text "Replaced 1 time"

### S4.12 A public ballot cannot be replaced

- **As a** Donor Dani
- **I want to** see plainly that my public ballot is locked
- **so that** I do not look for a replace action that does not exist
- **Release:** R1 | **Tests:** H6 | **Status:** planned
- **Scenario:** a donor with a public ballot opens the ballot page
- **Given** I am connected and have a direct ballot on chain
- **When** I open `/ballot`
- **Then** it shows "Public and final" with no "Replace ballot" control, and the text "Final ballots cannot be changed."

### S4.13 Move proposals without dragging

- **As a** voter using touch or a keyboard
- **I want to** select a proposal and choose its destination
- **so that** I can build the same ballot without a dragging gesture
- **Release:** R1 | **Tests:** H1 | **Status:** built
- **Scenario:** a keyboard user moves a proposal
- **Given** I focus a proposal button and activate it with Enter or Space
- **When** I activate a destination's "Move here" button
- **Then** the proposal moves, selection clears, focus follows it, and a polite status announces its title and destination

Escape or selecting the same proposal again cancels without moving it. While a
ballot is being stored, selection is cleared and all movement is disabled. Empty
tiers remain usable, title updates preserve assignments, and all-unplaced ballots
remain valid. See the [tier list specification](../components/tier-list.md).
