# Feedback: wallet-native storage for dApps

Swarm ID is great, and I can see its value for apps that want personal identities
and storage. For our dApp, RankedShares, we would love a flow built around the
Ethereum wallet the user already has.

I understand the suggestion that the organizer should manage the Swarm ID and
storage. My concern is the integration path this leaves for users. If it requires
my application backend to receive and upload every file, that introduces an
operational dependency I would prefer to avoid.

What I would like is an Ethereum-native flow: the user interacts with our protocol
using their existing wallet, pays the storage cost in that transaction, and the
frontend uploads to Swarm using the resulting authorization. Ideally, an address
on any supported EVM chain could pay to create or extend a batch, with batch IDs
and signing keys handled automatically.

For example, when someone submits or edits a proposal, our protocol could include
the storage cost in that same transaction. As an organizer, it would be much
easier to charge users for storage through their normal protocol interactions
than to ask them to create a separate identity, manage another recovery phrase,
fund another account, or manually enter batch IDs and signer keys.

The contract would handle payment and authorization, while the frontend and Swarm
infrastructure would handle the actual upload. Swarm ID could remain useful for
organizer management, while proposers would not need another account.

The experience I am imagining is: **connect your existing wallet → use the
protocol and pay for storage → the app stores your data on Swarm.**

Is this possible with the existing primitives, or is it something you are
considering? A minimal example connecting contract payment, batch provisioning or
extension, and browser uploads would be especially valuable.
