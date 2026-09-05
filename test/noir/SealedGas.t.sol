// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixtureLoader} from "./FixtureLoader.sol";

/// @dev Documents the sealed pool's costs on the default fixture (70 voters, 65 sealed,
///      16 projects). Numbers feed the README and spec B10.
contract SealedGasTest is FixtureLoader {
    function setUp() public {
        loadFixture("default_main");
        deployFromFixture();
        replayVoters();
    }

    function test_closeGasPerVoter() public {
        vm.warp(DEADLINE);
        uint256 before = gasleft();
        pool.close(1000);
        uint256 used = before - gasleft();
        emit log_named_uint("close() gas, 70 voters (65 sealed)", used);
        emit log_named_uint("close() gas per sealed voter (approx)", used / 65);
        assertLt(used, 12_000_000);
    }

    function test_reportGas() public {
        closeAll(1000);
        uint256 steps = fxCount(".transcript");
        uint256 width = fxUint(".m") + 3;
        uint256[] memory flat = new uint256[](steps * width);
        for (uint256 s = 0; s < steps; s++) {
            uint256[] memory step = fxUintArray(string.concat(".transcript[", vm.toString(s), "]"));
            for (uint256 w = 0; w < width; w++) {
                flat[s * width + w] = step[w];
            }
        }
        bytes memory report = abi.encode(uint8(1), abi.encode(fxBytes32(".inputsRoot"), fxUintArray(".funded"), flat));
        vm.prank(forwarder);
        uint256 before = gasleft();
        pool.onReport("", report);
        uint256 used = before - gasleft();
        emit log_named_uint("onReport(kind 1) gas, 23 transcript steps", used);
        assertLt(used, 12_000_000);
    }

    function test_voteSealedGas() public {
        // A fresh seat holder: first sealed vote, then a replacement.
        address v = makeAddr("gasVoter");
        address[] memory members = new address[](1);
        members[0] = v;
        vm.prank(org);
        pool.sponsor(30_000_000, members);
        uint256[] memory ct = fxWords(".voters[3].ciphertext");
        vm.startPrank(v);
        uint256 before = gasleft();
        pool.voteSealed(ct[0], ct[1], ct[2]);
        emit log_named_uint("voteSealed gas, first", before - gasleft());
        before = gasleft();
        pool.voteSealed(ct[0], ct[1], ct[2] + 1);
        emit log_named_uint("voteSealed gas, replacement", before - gasleft());
        vm.stopPrank();
    }
}
