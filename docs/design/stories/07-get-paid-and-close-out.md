# Get paid and close out (activity 7)

Proposer Pau and Organiser Ona finish the round. The screens are the project page at
`/project/:id`, where a funded project is claimed, and the organiser's page at
`/setup`, where the leftover is swept. The stories test H11, funded and paid are two
states so nobody chases a payment, and H7, irreversible actions are confirmed with a
summary. Contract facts are from `README.md`: `claim(projectId)` is permissionless and
pays the recipient exactly the project's cost; `sweep(to)` is owner-only and moves the
leftover, which is abstaining weight plus the budget of unfunded projects.

### S7.1 Funded and paid are two states

- **As a** Proposer Pau
- **I want to** see whether my funded project has been paid yet
- **so that** I know whether to expect money or to act
- **Release:** R1 | **Tests:** H11 | **Status:** planned
- **Scenario:** a funded, unclaimed project shows both states
- **Given** `finality()` is set and the project is in `fundedProjects()`
- **and Given** `claim` has not been called for the project
- **When** I open `/project/:id`
- **Then** the page shows the status "Funded, not yet paid" with the cost and the recipient address

### S7.2 A funded project can be claimed from its page

- **As a** Proposer Pau
- **I want to** trigger the payout myself
- **so that** the money arrives without waiting for anyone else
- **Release:** R1 | **Tests:** H11 | **Status:** planned
- **Scenario:** the claim action sends one `claim(projectId)` transaction
- **Given** the project is funded and not yet paid
- **and Given** my wallet is connected on the pool's chain
- **and Given** the page shows a "pay this project" button
- **When** I press "pay this project" and confirm in my wallet
- **Then** a `claim` transaction for the project id is sent and, once mined, the page's status changes to "Paid"

### S7.3 A paid project shows the payment

- **As a** Proposer Pau
- **I want to** see that the payment happened and how much
- **so that** I can stop checking my wallet
- **Release:** R1 | **Tests:** H11 | **Status:** planned
- **Scenario:** a claimed project reports the transfer
- **Given** `claim` has been called for the project
- **When** I open `/project/:id`
- **Then** the page shows "Paid" with the amount in the token's units, the recipient address, and a link to the claim transaction on the block explorer

### S7.4 An unfunded project says so plainly

- **As a** Proposer Pau
- **I want to** see clearly that my project was not funded
- **so that** I can move on rather than wait
- **Release:** R1 | **Tests:** H11 | **Status:** planned
- **Scenario:** a project outside the funded set has no claim action
- **Given** `finality()` is set and the project is not in `fundedProjects()`
- **When** I open `/project/:id`
- **Then** the page shows "Not funded" and no "pay this project" button is rendered

### S7.5 The claim action waits for finality

- **As a** Proposer Pau
- **I want to** be told when a claim is not yet possible
- **so that** I do not send a transaction that reverts
- **Release:** R1 | **Tests:** H11 | **Status:** planned
- **Scenario:** before finality the page explains the wait
- **Given** the deadline has passed and `finality()` is not yet set
- **When** I open `/project/:id`
- **Then** the page shows "Payment opens once the result is final" and no "pay this project" button is rendered

### S7.6 The organiser sees the leftover and its reasons

- **As a** Organiser Ona
- **I want to** see how much is left in the pool and why
- **so that** I can explain to members what was not spent
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** the setup page breaks down the leftover after finality
- **Given** `finality()` is set
- **and Given** my wallet is the pool owner
- **and Given** the API reports the abstaining weight and the total cost of unfunded projects
- **When** I open `/setup`
- **Then** the page shows the sweepable amount and two lines beneath it, "abstaining weight" and "unfunded projects", each with its amount in the token's units

### S7.7 Sweep asks for confirmation with a summary

- **As a** Organiser Ona
- **I want to** confirm the sweep after reading what it moves
- **so that** I do not empty the pool by accident
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** pressing sweep opens a confirmation, not a transaction
- **Given** the sweepable amount is greater than zero
- **and Given** the setup page shows a "sweep the leftover" button
- **When** I press "sweep the leftover"
- **Then** a confirmation dialog opens showing the amount, the destination address field, and the sentence "this cannot be undone", and no transaction has been sent

### S7.8 A confirmed sweep sends one transaction

- **As a** Organiser Ona
- **I want to** send the sweep once I have confirmed it
- **so that** the leftover returns to the treasury
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** confirming the dialog calls `sweep(to)`
- **Given** the sweep confirmation dialog is open with a valid destination address
- **When** I press "confirm sweep" and approve in my wallet
- **Then** a `sweep` transaction to the entered address is sent and, once mined, the page shows "Swept" with the amount and the stage bar marks "paid" as current

### S7.9 Sweep is blocked while funded projects are unpaid

- **As a** Organiser Ona
- **I want to** be warned when funded projects have not been paid yet
- **so that** I pay them before closing out
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** unpaid funded projects are listed above the sweep action
- **Given** `finality()` is set
- **and Given** at least one funded project has not been claimed
- **When** I open `/setup`
- **Then** the page lists each unpaid funded project with a "pay this project" button and shows the note "sweeping does not touch money owed to funded projects"

### S7.10 Non-owners do not see the sweep action

- **As a** Donor Dani
- **I want to** see the leftover without being offered an action I cannot take
- **so that** the page is honest about who can do what
- **Release:** R1 | **Tests:** H7 | **Status:** planned
- **Scenario:** a non-owner wallet on the setup page
- **Given** `finality()` is set
- **and Given** my connected wallet is not the pool owner
- **When** I open `/setup`
- **Then** the leftover breakdown is shown and no "sweep the leftover" button is rendered
