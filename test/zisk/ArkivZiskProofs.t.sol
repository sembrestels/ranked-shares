// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ZiskFinalizeTest} from "./ZiskFinalize.t.sol";

contract ArkivZiskProofsTest is ZiskFinalizeTest {
    function useArkiv() internal pure override returns (bool) {
        return true;
    }
}
