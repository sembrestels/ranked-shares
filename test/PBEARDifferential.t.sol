// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PBEARHarness} from "./PBEARHarness.sol";

/// @dev Differential fuzz: random small instances are tallied on-chain and by
///      `reference/pbear.py`, which also brute-forces the IPSC axiom.
contract PBEARDifferentialTest is Test {
    PBEARHarness engine;

    function setUp() public {
        engine = new PBEARHarness();
    }

    function rand(uint256 seed, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, salt)));
    }

    /// @dev Random competition ranking: shuffle, keep a prefix, merge some
    ///      adjacent positions into ties, leave the rest unranked.
    function randomBallot(uint256 seed, uint256 m) internal pure returns (bytes memory ranks) {
        uint256[] memory order = new uint256[](m);
        for (uint256 i = 0; i < m; i++) {
            order[i] = i;
        }
        for (uint256 i = m; i > 1; i--) {
            uint256 j = rand(seed, 100 + i) % i;
            (order[i - 1], order[j]) = (order[j], order[i - 1]);
        }
        uint256 kept = rand(seed, 200) % (m + 1);
        ranks = new bytes(m);
        uint8 rank = 1;
        for (uint256 pos = 0; pos < kept; pos++) {
            if (pos == 0 || rand(seed, 300 + pos) % 10 >= 4) rank = uint8(pos + 1);
            ranks[order[pos]] = bytes1(rank);
        }
    }

    function ranksJson(bytes memory ranks) internal pure returns (string memory out) {
        out = "[";
        for (uint256 c = 0; c < ranks.length; c++) {
            out = string.concat(out, c == 0 ? "" : ",", vm.toString(uint8(ranks[c])));
        }
        out = string.concat(out, "]");
    }

    function testFuzz_matchesReferenceAndSatisfiesIPSC(uint256 seed, bool allVote) public {
        _tallyAndCompare(seed, allVote, false);
    }

    /// @dev Ballots that withhold some unranked projects, against the unchanged
    ///      reference run on the padded ballots `reference/withhold.py` builds: one
    ///      "return the money" candidate ranked above the withheld projects.
    function testFuzz_withholdingMatchesReferenceOnPaddedBallots(uint256 seed, bool allVote) public {
        _tallyAndCompare(seed, allVote, true);
    }

    function _tallyAndCompare(uint256 seed, bool allVote, bool withholding) internal {
        uint256 n = 1 + rand(seed, 1) % 7;
        uint256 m = 1 + rand(seed, 2) % 5;

        string memory json = "{\"costs\":[";
        for (uint256 c = 0; c < m; c++) {
            uint256 cost = 1 + rand(seed, 10 + c) % 10;
            engine.addProject(cost);
            json = string.concat(json, c == 0 ? "" : ",", vm.toString(cost));
        }
        json = string.concat(json, "],\"voters\":[");

        for (uint256 i = 0; i < n; i++) {
            address voter = address(uint160(1000 + i));
            uint256 weight = 1 + rand(seed, 20 + i) % 10;
            engine.increaseTotalWeight(weight);
            engine.grantWeight(voter, weight);
            bool votes = allVote || rand(seed, 40 + i) % 10 < 7;
            string memory ballotJson = "null";
            if (votes) {
                bytes memory ranks = randomBallot(rand(seed, 60 + i), m);
                if (withholding) {
                    // A third of the voters withhold everything they did not rank, a
                    // third some of it, a third nothing.
                    uint256 habit = rand(seed, 80 + i) % 3;
                    for (uint256 c = 0; c < m; c++) {
                        if (ranks[c] != 0 || habit == 2) continue;
                        if (habit == 0 || rand(seed, 400 + 16 * i + c) % 2 == 0) ranks[c] = bytes1(engine.WITHHELD());
                    }
                }
                engine.setBallot(voter, ranks);
                ballotJson = ranksJson(ranks);
            }
            json = string.concat(json, i == 0 ? "" : ",", "[", vm.toString(weight), ",", ballotJson, "]");
        }

        uint256 abstaining = allVote ? 0 : rand(seed, 3) % 11;
        engine.increaseTotalWeight(abstaining);
        json = string.concat(json, "],\"abstaining\":", vm.toString(abstaining), "}");

        engine.startTally();
        engine.run(type(uint256).max);
        uint256[] memory onChain = engine.fundedProjects();

        string[] memory cmd = new string[](3);
        cmd[0] = "python3";
        cmd[1] = withholding ? "reference/withhold.py" : "reference/pbear.py";
        cmd[2] = json;
        uint256[] memory ref = abi.decode(vm.ffi(cmd), (uint256[]));

        assertEq(ref[0], 1, "IPSC violated");
        assertEq(onChain.length, ref.length - 2, "funded count differs from reference");
        for (uint256 k = 0; k < onChain.length; k++) {
            assertEq(onChain[k], ref[k + 2], "funded order differs from reference");
        }
        if (allVote) {
            // With withholding the reference judges the padded outcome, in which the
            // returned money is spent on the return candidate; the engine may then
            // end with money left and projects it could still afford.
            assertEq(ref[1], 1, "not exhaustive");
            if (!withholding) assertTrue(engine.isExhausted());
        }
        assertTrue(engine.tallyDone());
    }
}
