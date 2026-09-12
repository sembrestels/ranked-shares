// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {RealProofsTest} from "./RealProofs.t.sol";

/// Same pre-generated proofs must still verify with payloads supplied from Arkiv.
contract ArkivRealProofsTest is RealProofsTest {
    function useArkiv() internal pure override returns (bool) {
        return true;
    }
}
