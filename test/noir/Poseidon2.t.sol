// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Poseidon2} from "../../src/noir/lib/Poseidon2.sol";

contract Poseidon2Test is Test {
    using stdJson for string;

    Poseidon2 poseidon;
    string json;

    function setUp() public {
        poseidon = new Poseidon2();
        json = vm.readFile("reference/vectors/noir/poseidon2.json");
    }

    function count(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function toUints(bytes32[] memory b) internal pure returns (uint256[] memory out) {
        out = new uint256[](b.length);
        for (uint256 i = 0; i < b.length; i++) {
            out[i] = uint256(b[i]);
        }
    }

    function test_permutationMatchesVectors() public view {
        uint256 n = count(".permutation");
        assertGt(n, 0);
        for (uint256 i = 0; i < n; i++) {
            string memory key = string.concat(".permutation[", vm.toString(i), "]");
            uint256[] memory input = toUints(json.readBytes32Array(string.concat(key, ".input")));
            uint256[] memory expected = toUints(json.readBytes32Array(string.concat(key, ".output")));
            uint256[4] memory state = [input[0], input[1], input[2], input[3]];
            uint256[4] memory got = poseidon.permutation(state);
            for (uint256 j = 0; j < 4; j++) {
                assertEq(got[j], expected[j]);
            }
        }
    }

    function test_hashMatchesVectors() public view {
        uint256 n = count(".hash");
        assertGt(n, 0);
        for (uint256 i = 0; i < n; i++) {
            string memory key = string.concat(".hash[", vm.toString(i), "]");
            uint256[] memory input = toUints(json.readBytes32Array(string.concat(key, ".input")));
            uint256 expected = uint256(json.readBytes32(string.concat(key, ".output")));
            assertEq(poseidon.hash(input), expected);
        }
    }

    function test_hashDependsOnLength() public view {
        uint256[] memory a = new uint256[](1);
        a[0] = 1;
        uint256[] memory b = new uint256[](2);
        b[0] = 1;
        assertNotEq(poseidon.hash(a), poseidon.hash(b));
    }

    function test_rejectsInputsOutsideField() public {
        uint256[] memory a = new uint256[](1);
        a[0] = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        vm.expectRevert(Poseidon2.NotInField.selector);
        poseidon.hash(a);
    }

    function test_gasOfSixElementHash() public {
        uint256[] memory a = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            a[i] = i + 1;
        }
        uint256 before = gasleft();
        poseidon.hash(a);
        uint256 used = before - gasleft();
        emit log_named_uint("Poseidon2.hash(6 elements) gas", used);
        // Two permutations. 107,560 with the unrolled rounds (117,803 before), + 10%.
        assertLt(used, 118_000);
    }
}
