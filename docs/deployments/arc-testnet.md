# Arc testnet deployments

Every RankedShares pool used for the ETHOnline 2026 demo runs on **Arc testnet, chain
ID 5042002**, RPC `https://rpc.testnet.arc.network`, explorer
`https://testnet.arcscan.app`. All contracts were deployed on 13 September 2026 from
the organizer account `0x5A57DB3F5c9469534f76EF279193B502F77F2860` with USDC as gas.
Each address below was checked on 13 September 2026 at 09:08 UTC with `cast code`
against the Arc RPC, and the four live pools answered `votingOpen`, `totalWeight`,
`projectCount` and `votingDeadline` calls. The transaction hashes come from the
receipts in `demo/`.

Tokens: USDC `0x3600000000000000000000000000000000000000` (native gas token, ERC-20
interface) and EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, both official Arc
testnet addresses.

## Pools

| Pool | Variant | Address | Creation tx | Block | State on 13 Sep 09:08 UTC |
| --- | --- | --- | --- | --- | --- |
| Urbe Hub USDC CRE Liquidity open demo | CRE, LP module, castBallot, Arkiv | `0x20cb7d0c8ca90d0518834adac2ff9062230313d0` | `0xf29532cc869047fe1e4863da1724b0aac1b89d89c16582a3b331d03d1e31db1b` | 61915792 | Deployed 14:57 UTC; open until 20:36:30 UTC; 15 projects, 20 USDC weight, 20 ballots stored in Arkiv; LP sponsorships 0 and 1 of 5 USDC each |
| Urbe Hub EURC open demo | Noir, castBallot, Arkiv | `0xc1e005c69ff5b26eb21d8d64980387800f4f4501` | `0x7ee1b3cc4c0ff01e1fc82e5d7436e929b7744231b99c9ab6699946c915e23765` | 61913287 | Deployed 14:36 UTC; open until 20:36:30 UTC; 15 projects, 20 EURC weight, 20 ballots stored in Arkiv |
| Urbe Hub EURC short demo | Noir, castBallot, Arkiv | `0x70387e2963bc7fd796545988edb8ea08449f9b96` | `0x0144992a6f4e7d3b9b7c70cfd861b1e88db48141a3f4b5fdbfe7537b14b6c694` | 61859675 | Closed, **Proven**; 15 projects, 20 EURC weight, 11 funded, 19.05 EURC allocated |
| Urbe Hub EURC Noir | Noir, castBallot, Arkiv | `0x1fb1595b7330296e4d55e759209a2783ce4cfd36` | `0x41c41a3acf4663d240b8d1149e352916336bc080ce17a78327ec49d37db03455` | 61854092 | Open until 10:25:32 UTC; 15 projects, 20 EURC weight, 20 ballots |
| Golem USDC CRE Liquidity | CRE, LP module, castBallot, Arkiv | `0x56e4c0836f694bbbcf705c440feafea22dbfd18f` | `0x7d2438d7792c57932163b7e91d34c63715591c9b473172ed032bdf1d6a182d25` | 61854288 | Open until 10:25:32 UTC; 6 projects, 20 USDC weight, 20 ballots |
| Urbe Hub EURC sealed Noir (version 1) | Noir, separate contribute and vote | `0x35a7915dc29c67805b7323e5a0384f919c9cf210` | `0xc413e9a7cbe7a3b5c0f4c3992168bc5647154f59571f9e1159d477a4790e3fe5` | 61842705 | Open until 10:25:32 UTC; 15 projects, 22 EURC weight; superseded by the version 2 pools |
| Golem USDC CRE Liquidity (version 1) | CRE, LP module | `0x2bf2515baf13444a4c91d9135172a4a632fa440c` | `0x8390533d784cc618b2852d3a30c9750d7cd7397cace8e60f3d9773fba0aded26` | 61842726 | Never opened, no projects; superseded |

The first five pools are the ones the web app lists in `VITE_ROUNDS`; the open
demo pool was added on 13 September 2026 at 14:43 UTC after its 20 ballots were
verified in Arkiv. The short demo
pool is the only completed round: it closed with transaction
`0x177c68fc4d738f9238b9e4a25ef213db94a60f9d217ac66a1e610713f07aa039`, received the
CRE report `0x9cd11ee9fd023222774fe75ca04c19c919d8703f3bbdc35bdb4b2a62eb978b2b`, and
reached Proven finality with one ingest proof and three Noir tally proofs in
`0x30633e66126fdde88ba2443eee13341172622e10d6d5e6d2236252d1e21211af` (block 61861156).
Funded project IDs, in tally order: 7, 11, 3, 0, 10, 9, 6, 14, 2, 5, 12.

## Shared contracts

Deployed once and reused by every pool.

| Contract | Address | Creation tx | Block |
| --- | --- | --- | --- |
| Poseidon2 | `0x70cef785dacba0d030abaade23f295bcd33b0b7e` | `0xb030c2b7ee99c2a914bca865932444a6247fc7d0ea9cc20ee0be21287ecca01f` | 61842693 |
| Noir ingest verifier | `0xd75085951a67f615a9a9bd61b0277e3b66569785` | `0x6be1f639321760d3410187a76154e1dd0e7859066b639b6cc3e60561d5640672` | 61842697 |
| Noir tally verifier | `0xc30804d65ddee5a1a8532a5dfb8958a1558d02ac` | `0xc46fefc326faa0870181097708709fc1a3bb8d22f6cf6605c0505bb1733262b6` | 61842701 |
| Uniswap v4 PoolManager | `0xa9860932d9ecd8c6d1889ee42220221dc72e60e6` | `0xcd703309947a53c8a49c9550bc4d93015202499620652a2e6522c8f5091ea8f9` | 61842708 |
| Uniswap v4 PositionDescriptor | `0xd1a3d29679d83a2f31b8ffd01d172685ac087558` | `0x78aa3bd67228134f69328474048e7173bd247ae3a42fedab116dae798b1b642f` | 61842712 |
| Uniswap v4 PositionManager | `0x52074d82f3076e2290f5dca881d6ef4e2b553056` | `0x1310318cb1535eb85698ae3f9b20d54ad50164ebc282dbbda69a47286ddc80b5` | 61842717 |
| Uniswap v4 StateView | `0x2c517696911ef8ea8e68368ff58b9f3253d12c3f` | `0xbfc5f5bee7d7c4ef8143c68398c9742c0c1f504d8ce24feb80170e5344ee0f92` | 61842721 |
| LP voting module (open demo, attached to the USDC CRE Liquidity open demo pool) | `0xb6ad0ef6d25ff6c280e55c9d02590164193208c4` | `0x5a4d700520b8ba3df48e2f3d2b6614b559db631be679685b97c02fb3358bb082` | 61915801 |
| Demo DAO token (permissionless mint, no value) | `0xf66a6d64301279c62833fd8677a97e27076895ff` | see `demo/dao-seats-deployment.json` | 61916986 |
| LP voting module (version 2, attached to the Golem pool) | `0xc6953cb7dea386a1711de10125df3a5ff5c824ef` | `0x24e1c18dbd3778ded7e10e2cdc041f9f460363f4ac6fce1ce3c31e8d732b0061` | 61854297 |
| LP voting module (version 1) | `0x6722459adb67f35bfff3b576cb82988f8f189891` | `0xce25432302ad304425bda1ac2532bdd9e648ab1deddff2821201464f5c889609` | 61842731 |

Arc testnet has no official Uniswap v4 deployment, so the v4 core and periphery above
are the pinned upstream revisions deployed by this project. Arc's canonical Permit2 is
reused.

## Demo boundary

These pools are testnet-only demo deployments. The CRE pools accept reports from
Chainlink's simulator forwarder `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1` with
workflow owner and name checks disabled, so their CRE reports are not authenticated
DON results. The 20 voters in each round are operator-controlled wallets, not
independent participants. Noir proof verification on the short demo pool is real.

## Records

- `demo/README.md`: how each round was deployed, imported and voted.
- `demo/deployment.json`: version 1 pools and shared contracts, all eleven receipts.
- `demo/new-flow-deployment.json`: version 2 pools, proposals, ballots and Arkiv keys.
- `demo/short-round-deployment.json`: the completed round, including closing, report
  and proof transactions.
- `arkiv/submission.md`: Arkiv storage transactions for every ballot.
