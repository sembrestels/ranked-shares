// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SealedRankedShares} from "../../src/SealedRankedShares.sol";
import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev Every fixture end to end: replay, close, report, ingest, tally, Proven.
contract SealedFixtureTest is FixtureLoader {
    function runFixture(string memory name, uint256 chunk) internal {
        loadFixture(name);
        deployFromFixture();
        replayVoters();
        closeAll(chunk);
        assertEq(pool.inputsRoot(), fxBytes32(".inputsRoot"), "inputsRoot");

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
        assertEq(pool.transcriptHash(), fxWord(".transcriptHash"), "transcriptHash");

        uint256 nI = fxCount(".ingestProofs");
        for (uint256 k = 0; k < nI; k++) {
            string memory p = string.concat(".ingestProofs[", vm.toString(k), "].");
            bytes32[] memory pi = new bytes32[](10);
            pi[0] = bytes32(fxUint(string.concat(p, "k")));
            pi[1] = bytes32(fxUint(string.concat(p, "nSealed")));
            pi[2] = bytes32(fxUint(string.concat(p, "m")));
            pi[3] = fxBytes32(string.concat(p, "budget"));
            pi[4] = fxBytes32(string.concat(p, "pkX"));
            pi[5] = fxBytes32(string.concat(p, "pkY"));
            pi[6] = fxBytes32(string.concat(p, "hIn"));
            pi[7] = fxBytes32(string.concat(p, "hOut"));
            pi[8] = fxBytes32(string.concat(p, "stateIn"));
            pi[9] = fxBytes32(string.concat(p, "stateOut"));
            pool.advance("", pi, false);
        }
        uint256 nT = fxCount(".tallyProofs");
        for (uint256 g = 0; g < nT; g++) {
            string memory p = string.concat(".tallyProofs[", vm.toString(g), "].");
            bytes32[] memory pi = new bytes32[](7);
            pi[0] = fxBytes32(string.concat(p, "costsHash"));
            pi[1] = fxBytes32(string.concat(p, "stateIn"));
            pi[2] = fxBytes32(string.concat(p, "stateOut"));
            pi[3] = bytes32(fxUint(string.concat(p, "done")));
            pi[4] = fxBytes32(string.concat(p, "tHashOut"));
            pi[5] = bytes32(fxUint(string.concat(p, "fundedCount")));
            pi[6] = fxBytes32(string.concat(p, "fundedOrderPacked"));
            pool.advance("", pi, false);
        }
        assertEq(uint256(pool.finality()), uint256(SealedRankedShares.Finality.Proven), "Proven");
        uint256[] memory order = fxUintArray(".funded");
        uint256[] memory got = pool.fundedProjects();
        assertEq(got.length, order.length, "funded length");
        for (uint256 i = 0; i < order.length; i++) {
            assertEq(got[i], order[i], "funded order");
        }
    }

    function test_testMain() public {
        runFixture("test_main", 3);
    }

    function test_testSmallm() public {
        runFixture("test_smallm", 100);
    }

    function test_testNosealed() public {
        runFixture("test_nosealed", 2);
    }

    function test_defaultMain() public {
        runFixture("default_main", 40);
    }
}
