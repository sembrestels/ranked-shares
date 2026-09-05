// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SealedPool} from "../SealedPool.sol";
import {IZiskVerifier} from "./IZiskVerifier.sol";

/// @title ZiskRankedShares
/// @notice A sealed-ballot pool whose whole tally is proven in a ZisK guest. `finalize`
///         accepts one PLONK proof whose committed public value is
///         `keccak256(abi.encode(inputsHash, tallierPk, fundedOrder))`: the pool
///         recomputes that hash from its own storage, so a proof over other inputs or
///         another key cannot match (spec Z5).
contract ZiskRankedShares is SealedPool {
    error PublicValuesMismatch();

    /// @dev ZisK's on-chain public values: 64 slots of 8 bytes, each a `u32` written as a
    ///      little-endian `u64`. The guest commits 32 bytes, so slots 0..8 carry them four
    ///      bytes at a time and everything else is zero.
    uint256 internal constant PUBLIC_VALUES_LENGTH = 512;

    IZiskVerifier public immutable verifier;
    bytes32 public immutable programVK;
    bytes32 public immutable rootC;

    constructor(
        IERC20 token_,
        address owner_,
        uint64 votingDeadline_,
        bytes memory tallierPk_,
        bytes32 keySalt_,
        uint256 minDirectVote_,
        uint64 abandonGrace_,
        IZiskVerifier verifier_,
        bytes32 programVK_,
        bytes32 rootC_
    ) SealedPool(token_, owner_, votingDeadline_, tallierPk_, keySalt_, minDirectVote_, abandonGrace_) {
        if (address(verifier_).code.length == 0 || programVK_ == bytes32(0) || rootC_ == bytes32(0)) {
            revert InvalidConfig();
        }
        verifier = verifier_;
        programVK = programVK_;
        rootC = rootC_;
    }

    function kind() external pure override returns (string memory) {
        return "zisk";
    }

    /// @notice The 32 bytes the guest must have committed for `fundedOrder` to be accepted.
    function expectedOutputHash(uint256[] calldata fundedOrder) public view returns (bytes32) {
        return keccak256(abi.encode(inputsHash, tallierPk, fundedOrder));
    }

    /// @notice Finalise with a ZisK proof. Anyone may call; the proof, not the caller, is
    ///         the authority. Reverts `PublicValuesMismatch` when `publicValues` do not
    ///         encode exactly `expectedOutputHash(fundedOrder)`, and with the verifier's
    ///         `InvalidProof` when the proof does not verify.
    function finalize(uint256[] calldata fundedOrder, bytes calldata publicValues, bytes calldata proofBytes)
        external
        inPhase(Phase.Tally)
    {
        if (!_encodesHash(publicValues, expectedOutputHash(fundedOrder))) revert PublicValuesMismatch();
        verifier.verifySnarkProof(programVK, rootC, publicValues, proofBytes);
        _finalize(fundedOrder, Finality.Proven);
    }

    /// @dev `pv[8i .. 8i+4] == h[4i .. 4i+4]` for `i < 8`, every other byte zero.
    function _encodesHash(bytes calldata pv, bytes32 h) internal pure returns (bool) {
        if (pv.length != PUBLIC_VALUES_LENGTH) return false;
        for (uint256 i = 0; i < PUBLIC_VALUES_LENGTH; i++) {
            bytes1 want = (i < 64 && i % 8 < 4) ? h[(i / 8) * 4 + (i % 8)] : bytes1(0);
            if (pv[i] != want) return false;
        }
        return true;
    }
}
