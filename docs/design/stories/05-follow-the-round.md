# Follow the round (activity 5)

Everyone on `/` (the round page), Proposer Pau and Donor Dani on `/project/:id`, Donor
Dani and Seat-holder Sol for their own ballot status. Tests H4 (the board keeps the
round alive), H6 (the current ballot is visible), and H10 (the project page is the link
people share). Source: R1 tasks of activity 5 in `docs/design/story-map.md`, including
the on-the-line pitch, which is now served from Swarm by the shipped proposal flow.

### S5.1 See public commitments per project on the round page

- **As a** Donor Dani
- **I want to** see how much public weight stands behind each project
- **so that** I can tell whether the projects I back are ahead or behind
- **Release:** R1 | **Tests:** H4 | **Status:** built
- **Scenario:** an observer without a wallet opens the round page during voting
- **Given** the round is open and the API round snapshot lists projects with their public commitments
- **and Given** I have no wallet connected
- **When** I open `/`
- **Then** each project row shows its name, its cost, and its public commitment in the token's units, sorted by public commitment descending

### S5.2 See the sealed total and the sealed voter count

- **As a** Seat-holder Sol
- **I want to** see how much sealed weight is in the round and how many sealed ballots exist
- **so that** I know the sealed side is alive even though no ranking is shown
- **Release:** R1 | **Tests:** H4 | **Status:** built
- **Scenario:** a seat holder opens the round page after casting
- **Given** the round is open and the API round snapshot carries the sealed total and the sealed voter count
- **When** I open `/`
- **Then** the page shows "Sealed weight" with the total in the token's units and "Sealed ballots" with the count, next to the public board

### S5.3 See the deadline as a countdown

- **As a** Donor Dani
- **I want to** see how long is left to vote
- **so that** I come back in time to cast or replace my ballot
- **Release:** R1 | **Tests:** H4 | **Status:** built
- **Scenario:** a donor opens the round page two days before the deadline
- **Given** the round is open and the deadline is 2 days and 3 hours away
- **When** I open `/`
- **Then** the stage bar shows "Open" and "Voting closes in 2 days 3 hours" with the deadline date and time in the viewer's time zone

### S5.4 See the round page move after my own transaction

- **As a** Donor Dani
- **I want to** see my contribution or ballot reflected on the round page right after it confirms
- **so that** I trust that the board is live and my action counted
- **Release:** R1 | **Tests:** H4 | **Status:** built
- **Scenario:** a donor's public ballot for project B confirms
- **Given** I am on `/` and my `vote` transaction ranking B first has just been mined
- **and Given** the page refetches the API round snapshot as soon as the receipt arrives
- **When** the refetched snapshot arrives
- **Then** project B's public commitment includes my weight and the page shows "Updated just now"

### S5.5 Read the pitch on the project page

- **As a** Donor Dani
- **I want to** read what a project proposes before I rank it
- **so that** my ranking is based on the work, not just the name and the cost
- **Release:** R1 | **Tests:** H10 | **Status:** built
- **Scenario:** a donor opens an accepted project's page
- **Given** project 3 was accepted from a proposal whose content reference resolves on Swarm to a manifest with a title, a body, and one attachment
- **When** I open `/project/3`
- **Then** the page shows the title, the body rendered as plain text, the attachment's name and size with a download control, and the pitch is never rendered as HTML

### S5.6 See the cost, support, and recipient on the project page

- **As a** Proposer Pau
- **I want to** see my project's cost, public support, and recipient address on its page
- **so that** I can check that what is listed is what I submitted and how far it has to go
- **Release:** R1 | **Tests:** H10 | **Status:** built
- **Scenario:** a proposer checks their listed project
- **Given** project 3 has cost 4000 USDC, recipient 0xabc…, and public commitment 1200 USDC
- **When** I open `/project/3`
- **Then** the page shows "Cost 4,000 USDC", "Public support 1,200 USDC", and the recipient address in full with a copy control

### S5.7 Project page without a resolvable pitch still works

- **As a** Donor Dani
- **I want to** see a project's page even when its pitch cannot be loaded
- **so that** I can still rank it and I know why the pitch is missing
- **Release:** R1 | **Tests:** H10 | **Status:** built
- **Scenario:** the content reference is zero or Swarm does not answer
- **Given** project 1 was added with a zero content reference, or its reference does not resolve within the fetch timeout
- **When** I open `/project/1`
- **Then** the page shows the cost, support, and recipient, and the notice "No pitch was published for this project" or "The pitch could not be loaded; try again", with a retry control in the second case

### S5.8 Rank this project from its page

- **As a** Donor Dani
- **I want to** start ranking from the project page I arrived at
- **so that** the link a proposer shared takes me straight to backing their project
- **Release:** R1 | **Tests:** H10 | **Status:** planned
- **Note:** waits for /vote
- **Scenario:** a donor arrives on a project page by a shared link
- **Given** I am on `/project/3` during the open stage
- **and Given** the page has a "Rank this project" control
- **When** I press "Rank this project"
- **Then** I am on `/vote` with project 3 already placed first in the ranked list

### S5.9 See my own ballot status on the round page

- **As a** Seat-holder Sol
- **I want to** see on the round page whether I have cast and whether my sealed ballot is in the roster
- **so that** I know I am counted without opening the ballot
- **Release:** R1 | **Tests:** H6 | **Status:** built
- **Scenario:** a seat holder with a sealed ballot opens the round page
- **Given** I am connected and the API voter response for my address says a sealed ballot exists and the address is in the roster
- **When** I open `/`
- **Then** the page shows "Your ballot: sealed, in the roster, replaceable until" followed by the deadline, with a link to `/vote`
- **Note:** `/ballot` is not a route yet; the link goes to `/vote`.

### S5.10 See that I have not cast yet

- **As a** Donor Dani
- **I want to** be told on the round page that I have weight but no ballot
- **so that** my money does not sit abstaining by oversight
- **Release:** R1 | **Tests:** H6 | **Status:** built
- **Scenario:** a donor contributed but never voted
- **Given** I am connected with contributed weight and the API voter response for my address says no ballot exists
- **When** I open `/`
- **Then** the page shows "Your ballot: not cast. Money without a ballot funds nothing." with a link to `/vote`

### S5.11 Share a project page with a link that unfurls

- **As a** Proposer Pau
- **I want to** share my project's link and have it show the project's name and cost in chat previews
- **so that** supporters know what they are clicking before they arrive
- **Release:** R1 | **Tests:** H10 | **Status:** built
- **Scenario:** a chat client fetches the project page without JavaScript
- **Given** `/project/3` was prerendered at build time for a project whose title is "Formal audit of the tally"
- **When** the page is fetched with a plain HTTP request
- **Then** the response contains a title tag and Open Graph title reading "Formal audit of the tally", a description naming the cost, and a canonical URL for `/project/3`

### S5.12 Share the round page with a link that unfurls

- **As a** Donor Dani
- **I want to** share the round itself with a link that previews the round's name and deadline
- **so that** people I invite see it is a live funding round
- **Release:** R1 | **Tests:** H10 | **Status:** built
- **Scenario:** a chat client fetches the round page without JavaScript
- **Given** `/` was prerendered at build time with the round's name and deadline
- **When** the page is fetched with a plain HTTP request
- **Then** the response contains a title tag and Open Graph title with the round's name, a description with the deadline, and a canonical URL for `/`
