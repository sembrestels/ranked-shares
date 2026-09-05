// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Grumpkin} from "../../src/noir/lib/Grumpkin.sol";

contract GrumpkinTest is Test {
    uint256 constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function test_generatorIsOnCurve() public pure {
        assertTrue(Grumpkin.isOnCurve(1, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }

    function test_negatedGeneratorIsOnCurve() public pure {
        assertTrue(Grumpkin.isOnCurve(1, P - 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }

    function test_rejectsOffCurveAndOutOfField() public pure {
        assertFalse(Grumpkin.isOnCurve(1, 1));
        assertFalse(Grumpkin.isOnCurve(0, 0));
        assertFalse(Grumpkin.isOnCurve(P, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
        assertFalse(Grumpkin.isOnCurve(1, P + 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C));
    }
}
