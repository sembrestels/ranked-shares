// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {IPoseidon2} from "../../src/interfaces/IPoseidon2.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MockHonkVerifier} from "../mocks/MockHonkVerifier.sol";

/// @dev Rebuilds a pool from one of the Python fixtures through the public API, so the
///      contract's commitments can be compared with the reference oracle.
abstract contract FixtureLoader is Test {
    using stdJson for string;

    string internal json;
    MockERC20 internal token;
    MockERC721 internal nft;
    Poseidon2 internal poseidon;
    MockHonkVerifier internal ingestVerifier;
    MockHonkVerifier internal tallyVerifier;
    SealedRankedShares internal pool;

    address internal owner = makeAddr("owner");
    address internal forwarder = makeAddr("forwarder");
    address internal coordinator = makeAddr("coordinator");
    address internal org = makeAddr("org");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant DEADLINE = 1_000_000;

    function loadFixture(string memory name) internal {
        json = vm.readFile(string.concat("reference/vectors/fixture_", name, ".json"));
    }

    // ---- JSON helpers ----

    function fxUint(string memory key) internal view returns (uint256) {
        return json.readUint(key);
    }

    function fxBytes32(string memory key) internal view returns (bytes32) {
        return json.readBytes32(key);
    }

    function fxWord(string memory key) internal view returns (uint256) {
        return uint256(json.readBytes32(key));
    }

    function fxBool(string memory key) internal view returns (bool) {
        return json.readBool(key);
    }

    function fxAddress(string memory key) internal view returns (address) {
        return json.readAddress(key);
    }

    function fxUintArray(string memory key) internal view returns (uint256[] memory) {
        return json.readUintArray(key);
    }

    function fxWords(string memory key) internal view returns (uint256[] memory out) {
        bytes32[] memory b = json.readBytes32Array(key);
        out = new uint256[](b.length);
        for (uint256 i = 0; i < b.length; i++) {
            out[i] = uint256(b[i]);
        }
    }

    function fxCount(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function voterKey(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".voters[", vm.toString(i), "].", field);
    }

    function ranksBytes(uint256[] memory ranks) internal pure returns (bytes memory out) {
        out = new bytes(ranks.length);
        for (uint256 i = 0; i < ranks.length; i++) {
            out[i] = bytes1(uint8(ranks[i]));
        }
    }

    // ---- pool construction ----

    /// @dev The verifiers the pool is built with. Mocks by default, so tests can accept or
    ///      reject a proof at will; `RealProofs.t.sol` overrides this with the generated
    ///      `test`-profile Honk verifiers.
    function makeVerifiers() internal virtual returns (IHonkVerifier ingest, IHonkVerifier tally) {
        ingestVerifier = new MockHonkVerifier();
        tallyVerifier = new MockHonkVerifier();
        return (IHonkVerifier(address(ingestVerifier)), IHonkVerifier(address(tallyVerifier)));
    }

    function deployFromFixture() internal {
        vm.warp(1);
        token = new MockERC20();
        nft = new MockERC721();
        poseidon = new Poseidon2();
        (IHonkVerifier iv, IHonkVerifier tv) = makeVerifiers();
        uint256[] memory pk = fxWords(".pk");
        SealedRankedShares.Config memory cfg = SealedRankedShares.Config({
            forwarder: forwarder,
            coordinator: coordinator,
            poseidon: IPoseidon2(address(poseidon)),
            ingestVerifier: iv,
            tallyVerifier: tv,
            tallierPkX: pk[0],
            tallierPkY: pk[1],
            keySalt: fxBytes32(".keySalt"),
            nSealedMax: fxUint(".profile.nSealedMax"),
            mMax: fxUint(".profile.mMax"),
            batch: fxUint(".profile.batch"),
            minDirectVote: fxWord(".minDirectVote"),
            minSealedVote: 1,
            proofGrace: 1 days,
            abandonGrace: 7 days
        });
        pool = new SealedRankedShares(token, owner, DEADLINE, cfg);
        uint256[] memory costs = fxWords(".costs");
        vm.startPrank(owner);
        for (uint256 c = 0; c < costs.length; c++) {
            pool.addProject(costs[c], recipient);
        }
        pool.openVoting();
        vm.stopPrank();
        token.mint(org, type(uint64).max);
        vm.prank(org);
        token.approve(address(pool), type(uint256).max);
    }

    function replayVoters() internal {
        uint256 n = fxCount(".voters");
        uint256 granted;
        for (uint256 i = 0; i < n; i++) {
            address a = fxAddress(voterKey(i, "addr"));
            uint256 direct = fxWord(voterKey(i, "directWeight"));
            uint256 seat = fxWord(voterKey(i, "seatWeight"));
            if (direct > 0) {
                token.mint(a, direct);
                vm.startPrank(a);
                token.approve(address(pool), direct);
                pool.contribute(direct);
                vm.stopPrank();
            }
            if (seat > 0) {
                address[] memory members = new address[](1);
                members[0] = a;
                vm.prank(org);
                pool.sponsor(seat, members);
            }
            if (fxBool(voterKey(i, "hasDirect"))) {
                vm.prank(a);
                pool.vote(ranksBytes(fxUintArray(voterKey(i, "directRanks"))));
            }
            granted += direct + seat;
        }
        for (uint256 i = 0; i < n; i++) {
            if (!fxBool(voterKey(i, "hasSealed"))) continue;
            uint256[] memory ct = fxWords(voterKey(i, "ciphertext"));
            vm.prank(fxAddress(voterKey(i, "addr")));
            pool.voteSealed(ct[0], ct[1], ct[2]);
        }
        uint256 dust = fxWord(".totalWeight") - granted;
        if (dust > 0) {
            vm.prank(org);
            pool.sponsorNFT(dust, IERC721(address(nft)), dust);
        }
        assertEq(pool.totalWeight(), fxWord(".totalWeight"), "fixture totalWeight");
        assertEq(pool.voterCount(), n, "fixture voter count");
        for (uint256 i = 0; i < n; i++) {
            assertEq(pool.voters(i), fxAddress(voterKey(i, "addr")), "registration order");
        }
    }

    function closeAll(uint256 chunk) internal {
        vm.warp(DEADLINE);
        while (!pool.closed()) pool.close(chunk);
    }

    // ---- the DON's report and the fixture's proof public inputs ----

    /// @dev The kind-1 report the workflow would deliver: the fixture's result and the flat
    ///      transcript, from the forwarder.
    function report() internal {
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) {
                flat[s * width + w] = step[w];
            }
        }
        vm.prank(forwarder);
        pool.onReport("", abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat)));
    }

    /// @dev Batch `k`'s public inputs as the fixture records them, in circuit order. Paired
    ///      with a mock verifier this is a proof the pool accepts without any proving.
    function ingestInputs(uint256 k) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".ingestProofs[", vm.toString(k), "].");
        out = new bytes32[](10);
        out[0] = bytes32(fxUint(string.concat(p, "k")));
        out[1] = bytes32(fxUint(string.concat(p, "nSealed")));
        out[2] = bytes32(fxUint(string.concat(p, "m")));
        out[3] = fxBytes32(string.concat(p, "budget"));
        out[4] = fxBytes32(string.concat(p, "pkX"));
        out[5] = fxBytes32(string.concat(p, "pkY"));
        out[6] = fxBytes32(string.concat(p, "hIn"));
        out[7] = fxBytes32(string.concat(p, "hOut"));
        out[8] = fxBytes32(string.concat(p, "stateIn"));
        out[9] = fxBytes32(string.concat(p, "stateOut"));
    }

    /// @dev Tally group `g`'s public inputs, as `ingestInputs` does for a batch.
    function tallyInputs(uint256 g) internal view returns (bytes32[] memory out) {
        string memory p = string.concat(".tallyProofs[", vm.toString(g), "].");
        out = new bytes32[](7);
        out[0] = fxBytes32(string.concat(p, "costsHash"));
        out[1] = fxBytes32(string.concat(p, "stateIn"));
        out[2] = fxBytes32(string.concat(p, "stateOut"));
        out[3] = bytes32(fxUint(string.concat(p, "done")));
        out[4] = fxBytes32(string.concat(p, "tHashOut"));
        out[5] = bytes32(fxUint(string.concat(p, "fundedCount")));
        out[6] = fxBytes32(string.concat(p, "fundedOrderPacked"));
    }
}
