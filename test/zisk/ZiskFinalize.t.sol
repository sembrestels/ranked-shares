// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {WrongPhase} from "../../src/PoolBase.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {ZiskRankedShares} from "../../src/zisk/ZiskRankedShares.sol";
import {ZiskVerifier} from "../../src/zisk/ZiskVerifier.sol";
import {IZiskVerifier} from "../../src/zisk/IZiskVerifier.sol";
import {MockZiskVerifier} from "../mocks/MockZiskVerifier.sol";
import {ZiskFixtureLoader} from "./ZiskFixtureLoader.sol";

contract ZiskFinalizeTest is ZiskFixtureLoader {
    using stdJson for string;

    string internal calldataJson;
    MockZiskVerifier internal mock;
    ZiskVerifier internal real;
    ZiskRankedShares internal zpool;

    bytes32 internal programVK;
    bytes32 internal rootC;
    bytes internal publicValues;
    bytes internal proofBytes;
    uint256[] internal fundedOrder;

    function setUp() public {
        loadFixture("main");
        calldataJson = vm.readFile("zisk/fixtures/main-calldata.json");
        programVK = calldataJson.readBytes32(".programVK");
        rootC = calldataJson.readBytes32(".rootCVadcopFinal");
        publicValues = calldataJson.readBytes(".publicValues");
        proofBytes = calldataJson.readBytes(".proofBytes");
        fundedOrder = fxUintArray(".funded");
        newMocks();
        mock = new MockZiskVerifier();
        real = new ZiskVerifier();
    }

    function deployWith(IZiskVerifier v) internal {
        deployAt(
            "ZiskRankedShares.sol:ZiskRankedShares",
            abi.encode(
                token,
                owner,
                DEADLINE,
                fxPk(),
                fxBytes32(".keySalt"),
                fxWord(".minDirectVote"),
                ABANDON_GRACE,
                v,
                programVK,
                rootC
            )
        );
        zpool = ZiskRankedShares(address(pool));
    }

    function test_kindAndImmutables() public {
        deployWith(IZiskVerifier(address(mock)));
        assertEq(zpool.kind(), "zisk");
        assertEq(address(zpool.verifier()), address(mock));
        assertEq(zpool.programVK(), programVK);
        assertEq(zpool.rootC(), rootC);
    }

    function test_constructorNeedsAVerifierWithCode() public {
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new ZiskRankedShares(
            token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days, IZiskVerifier(makeAddr("eoa")), programVK, rootC
        );
        vm.expectRevert(SealedPool.InvalidConfig.selector);
        new ZiskRankedShares(
            token, owner, DEADLINE, fxPk(), bytes32(0), 0, 1 days, IZiskVerifier(address(mock)), bytes32(0), rootC
        );
    }

    function test_expectedOutputHashMatchesTheFixture() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        assertEq(zpool.inputsHash(), fixtureInputsHash());
        assertEq(zpool.expectedOutputHash(fundedOrder), fxBytes32(".outputHash"));
    }

    function test_finalizeOnlyInTally() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        vm.expectRevert(WrongPhase.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    function test_finalizeRejectsWrongOrderOrMalformedPublicValues() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        uint256[] memory other = new uint256[](1);
        other[0] = 3;
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(other, publicValues, proofBytes);

        bytes memory shortPv = new bytes(511);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, shortPv, proofBytes);

        bytes memory padded = publicValues;
        padded[5] = 0x01; // padding byte inside slot 0
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, padded, proofBytes);

        bytes memory tail = publicValues;
        tail[511] = 0x01;
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, tail, proofBytes);

        bytes memory flipped = publicValues;
        flipped[0] = bytes1(uint8(flipped[0]) ^ 0x01);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, flipped, proofBytes);
    }

    function test_finalizeSurfacesVerifierRejection() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        mock.setAccept(false);
        vm.expectRevert(MockZiskVerifier.InvalidProof.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    function test_finalizeWithMockSetsEverything() public {
        deployWith(IZiskVerifier(address(mock)));
        replayVoters();
        closeAll(1000);
        vm.expectEmit(false, false, false, true);
        emit SealedPool.Finalized(SealedPool.Finality.Proven, fundedOrder);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
        assertEq(uint256(zpool.finality()), uint256(SealedPool.Finality.Proven));
        assertEq(zpool.fundedProjects(), fundedOrder);
        vm.expectRevert(WrongPhase.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }

    /// @dev The whole chain: fixture replayed at the fixture address, closed, and the
    ///      committed proof accepted by the real PLONK verifier. The bound is 800k, not
    ///      the 600k a naive estimate would give: Task 3 measured the real
    ///      `verifySnarkProof` alone at 515 230 gas.
    function test_finalizeWithTheRealProof() public {
        deployWith(IZiskVerifier(address(real)));
        replayVoters();
        closeAll(7);
        uint256 before = gasleft();
        zpool.finalize(fundedOrder, publicValues, proofBytes);
        uint256 used = before - gasleft();
        emit log_named_uint("finalize gas with the real verifier", used);
        assertLt(used, 800_000);
        assertEq(uint256(zpool.finality()), uint256(SealedPool.Finality.Proven));
        assertTrue(zpool.funded(0) && zpool.funded(1) && zpool.funded(2));
        assertFalse(zpool.funded(3));
        zpool.claim(1);
        assertEq(token.balanceOf(recipient), zpool.cost(1));
    }

    function test_realVerifierRejectsAProofForAnotherPool() public {
        // Same proof, a pool whose roster differs by one silent voter: inputsHash changes,
        // the expected hash changes, and the public values no longer encode it.
        deployWith(IZiskVerifier(address(real)));
        replayVoters();
        address extra = makeAddr("extra");
        token.mint(extra, 1);
        vm.startPrank(extra);
        token.approve(address(pool), 1);
        pool.contribute(1);
        vm.stopPrank();
        closeAll(1000);
        vm.expectRevert(ZiskRankedShares.PublicValuesMismatch.selector);
        zpool.finalize(fundedOrder, publicValues, proofBytes);
    }
}
