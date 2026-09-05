// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev `votersFrom`, the paged read the workflow and the prover rebuild the roster with,
///      against the fixture that produced the pool.
contract SealedViewsTest is FixtureLoader {
    function setUp() public {
        loadFixture("test_main");
        deployFromFixture();
        replayVoters();
    }

    function packed(uint256 i) internal view returns (uint256 p) {
        uint256[] memory ranks = fxUintArray(voterKey(i, "directRanks"));
        for (uint256 c = 0; c < ranks.length; c++) {
            p |= ranks[c] << (8 * c);
        }
    }

    function test_pagesMatchTheFixture() public view {
        uint256 n = fxCount(".voters");
        assertGt(n, 3, "the fixture must need more than one page");
        uint256 seen;
        for (uint256 start = 0; start < n; start += 3) {
            (
                address[] memory who,
                uint256[] memory direct,
                uint256[] memory ballots,
                uint256[] memory seats,
                uint256[3][] memory cts,
                bool[] memory flags
            ) = pool.votersFrom(start, 3);
            uint256 expected = n - start > 3 ? 3 : n - start;
            assertEq(who.length, expected, "page length");
            assertEq(direct.length, expected);
            assertEq(ballots.length, expected);
            assertEq(seats.length, expected);
            assertEq(cts.length, expected);
            assertEq(flags.length, expected);
            for (uint256 i = 0; i < who.length; i++) {
                uint256 v = start + i;
                assertEq(who[i], fxAddress(voterKey(v, "addr")), "addr");
                assertEq(direct[i], fxWord(voterKey(v, "directWeight")), "directWeight");
                assertEq(seats[i], fxWord(voterKey(v, "seatWeight")), "seatWeight");
                assertEq(flags[i], fxBool(voterKey(v, "hasDirect")), "hasDirect");
                assertEq(ballots[i], flags[i] ? packed(v) : 0, "ballot");
                if (fxBool(voterKey(v, "hasSealed"))) {
                    uint256[] memory ct = fxWords(voterKey(v, "ciphertext"));
                    assertEq(cts[i][0], ct[0], "rx");
                    assertEq(cts[i][1], ct[1], "ry");
                    assertEq(cts[i][2], ct[2], "c");
                } else {
                    assertEq(cts[i][0], 0, "no rx");
                    assertEq(cts[i][1], 0, "no ry");
                    assertEq(cts[i][2], 0, "no c");
                }
                seen++;
            }
        }
        assertEq(seen, n, "every voter paged exactly once");
    }

    /// @dev The fixture has a voter whose ballot packs to zero, which is why the flag and
    ///      not the packed word says whether a ballot exists.
    function test_zeroBallotIsDistinguishedByTheFlag() public view {
        uint256 n = fxCount(".voters");
        address silent;
        for (uint256 i = 0; i < n; i++) {
            if (!fxBool(voterKey(i, "hasDirect")) && fxWord(voterKey(i, "directWeight")) != 0) {
                silent = fxAddress(voterKey(i, "addr"));
            }
        }
        assertTrue(silent != address(0), "the fixture must have a silent direct voter");
        (,, uint256[] memory ballots,,, bool[] memory flags) = pool.votersFrom(0, n);
        for (uint256 i = 0; i < n; i++) {
            if (pool.voters(i) == silent) {
                assertFalse(flags[i]);
                assertEq(ballots[i], 0);
            }
        }
        assertEq(pool.directBallotOf(silent), 0);
    }

    function test_pastTheEndAndPartialPages() public view {
        uint256 n = fxCount(".voters");
        (address[] memory who,,,,,) = pool.votersFrom(n, 10);
        assertEq(who.length, 0, "start at the end");
        (who,,,,,) = pool.votersFrom(n + 5, 10);
        assertEq(who.length, 0, "start past the end");
        (who,,,,,) = pool.votersFrom(n - 1, 10);
        assertEq(who.length, 1, "clipped at the end");
        assertEq(who[0], fxAddress(voterKey(n - 1, "addr")));
        (who,,,,,) = pool.votersFrom(0, 0);
        assertEq(who.length, 0, "empty page");
        (who,,,,,) = pool.votersFrom(1, type(uint256).max);
        assertEq(who.length, n - 1, "a count that would overflow start + count");
    }
}
