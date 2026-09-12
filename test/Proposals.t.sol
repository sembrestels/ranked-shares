// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    PoolBase,
    EmptyContentReference,
    ZeroProposalCost,
    ZeroAddress,
    InvalidProposal,
    ProposalAlreadyReviewed,
    UnauthorizedProposalEditor,
    StaleProposalRevision,
    WrongPhase,
    DeadlinePassed
} from "../src/PoolBase.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {PBEAR} from "../src/PBEAR.sol";
import {SealedPool} from "../src/SealedPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockZiskVerifier} from "./mocks/MockZiskVerifier.sol";

contract ProposalsTest is Test {
    RankedShares pool;
    MockERC20 token;
    address owner = makeAddr("owner");
    address proposer = makeAddr("proposer");
    address recipient = makeAddr("recipient");
    bytes32 constant REF = keccak256("any proposal content");
    uint64 constant DEADLINE = 1_000_000;

    function setUp() public {
        vm.warp(1);
        token = new MockERC20();
        pool = new RankedShares(token, owner, DEADLINE);
    }

    function submit() internal returns (uint256) {
        vm.prank(proposer);
        return pool.propose(REF, 50, recipient);
    }

    function test_anyoneCanSubmitTermsWithoutAddingProject() public {
        vm.expectEmit(true, true, false, true);
        emit PoolBase.Proposed(0, proposer, REF, 50, recipient);
        assertEq(submit(), 0);
        (address who, bytes32 ref, uint256 amount, address to, PoolBase.ProposalStatus status,) = pool.proposals(0);
        assertEq(who, proposer);
        assertEq(ref, REF);
        assertEq(amount, 50);
        assertEq(to, recipient);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Pending));
        assertEq(pool.proposalCount(), 1);
        assertEq(pool.projectCount(), 0);
        assertEq(pool.proposalRevision(0), 1);
        assertEq(pool.proposalEditor(0), proposer);
    }

    function test_bothAuthorAndOwnerCanEditPendingProposalWithHistory() public {
        submit();
        bytes32 secondRef = keccak256("second revision");
        vm.expectEmit(true, true, false, true);
        emit PoolBase.ProposalEdited(0, proposer, 2, REF, secondRef, 60, recipient);
        vm.prank(proposer);
        pool.editProposal(0, 1, secondRef, 60, recipient);
        assertEq(pool.proposalRevision(0), 2);
        assertEq(pool.proposalEditor(0), proposer);

        bytes32 finalRef = keccak256("organizer revision");
        address finalRecipient = makeAddr("final recipient");
        vm.expectEmit(true, true, false, true);
        emit PoolBase.ProposalEdited(0, owner, 3, secondRef, finalRef, 75, finalRecipient);
        vm.prank(owner);
        pool.editProposal(0, 2, finalRef, 75, finalRecipient);
        (address who, bytes32 ref, uint256 amount, address to, PoolBase.ProposalStatus status,) = pool.proposals(0);
        assertEq(who, proposer); // editing never changes authorship
        assertEq(ref, finalRef);
        assertEq(amount, 75);
        assertEq(to, finalRecipient);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Pending));
        assertEq(pool.projectCount(), 0);
        assertEq(pool.proposalRevision(0), 3);
        assertEq(pool.proposalEditor(0), owner);
        vm.prank(owner);
        pool.acceptProposal(0, 3);
        assertEq(pool.contentRefOf(0), finalRef);
        assertEq(pool.cost(0), 75);
        assertEq(pool.recipientOf(0), finalRecipient);
    }

    function test_concurrentEditsAndStaleDecisionsCannotChangeCurrentRevision() public {
        submit();
        vm.prank(proposer);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(StaleProposalRevision.selector, 1, 2));
        pool.editProposal(0, 1, REF, 70, recipient);
        vm.expectRevert(abi.encodeWithSelector(StaleProposalRevision.selector, 1, 2));
        pool.acceptProposal(0, 1);
        vm.expectRevert(abi.encodeWithSelector(StaleProposalRevision.selector, 1, 2));
        pool.rejectProposal(0, 1);
        vm.stopPrank();
        assertEq(pool.proposalRevision(0), 2);
        assertEq(pool.projectCount(), 0);
        (,, uint256 amount,, PoolBase.ProposalStatus status,) = pool.proposals(0);
        assertEq(amount, 60);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Pending));
    }

    function test_onlyOriginalProposerOrCurrentOwnerCanEdit() public {
        submit();
        vm.prank(recipient);
        vm.expectRevert(UnauthorizedProposalEditor.selector);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.prank(owner);
        pool.transferOwnership(recipient);
        vm.prank(owner);
        vm.expectRevert(UnauthorizedProposalEditor.selector);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.prank(recipient);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.prank(proposer);
        pool.editProposal(0, 2, REF, 70, recipient);
        assertEq(pool.proposalRevision(0), 3);
    }

    function test_editsValidateTermsWithoutAdvancingRevision() public {
        submit();
        vm.startPrank(proposer);
        vm.expectRevert(EmptyContentReference.selector);
        pool.editProposal(0, 1, bytes32(0), 50, recipient);
        vm.expectRevert(ZeroProposalCost.selector);
        pool.editProposal(0, 1, REF, 0, recipient);
        vm.expectRevert(ZeroAddress.selector);
        pool.editProposal(0, 1, REF, 50, address(0));
        vm.expectRevert(InvalidProposal.selector);
        pool.editProposal(1, 1, REF, 50, recipient);
        vm.stopPrank();
        assertEq(pool.proposalRevision(0), 1);
    }

    function test_reviewLocksAcceptedAndRejectedProposalsForBothEditors() public {
        submit();
        submit();
        vm.startPrank(owner);
        pool.acceptProposal(0, 1);
        pool.rejectProposal(1, 1);
        vm.stopPrank();
        address[2] memory editors = [owner, proposer];
        for (uint256 i; i < editors.length; i++) {
            vm.startPrank(editors[i]);
            for (uint256 id; id < 2; id++) {
                vm.expectRevert(ProposalAlreadyReviewed.selector);
                pool.editProposal(id, 1, REF, 60, recipient);
            }
            vm.stopPrank();
        }
        assertEq(pool.cost(0), 50);
    }

    function test_votingAndDeadlineCloseEdits() public {
        submit();
        vm.warp(DEADLINE);
        vm.prank(proposer);
        vm.expectRevert(DeadlinePassed.selector);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.warp(DEADLINE - 1);
        vm.startPrank(owner);
        pool.addProject(50, recipient);
        pool.openVoting();
        vm.expectRevert(WrongPhase.selector);
        pool.editProposal(0, 1, REF, 60, recipient);
        vm.stopPrank();
    }

    function test_acceptBindsExactTermsAndProjectZero() public {
        submit();
        vm.expectEmit(true, true, false, true);
        emit PoolBase.ProposalAccepted(0, 0);
        vm.prank(owner);
        assertEq(pool.acceptProposal(0, 1), 0);
        assertEq(pool.projectCount(), 1);
        assertEq(pool.cost(0), 50);
        assertEq(pool.recipientOf(0), recipient);
        assertEq(pool.contentRefOf(0), REF);
        (,,,, PoolBase.ProposalStatus status, uint256 projectId) = pool.proposals(0);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Accepted));
        assertEq(projectId, 0);
    }

    function test_acceptanceOrderDeterminesProjectOrder() public {
        submit();
        pool.propose(bytes32(uint256(2)), 20, address(123));
        vm.startPrank(owner);
        pool.addProject(10, recipient);
        assertEq(pool.acceptProposal(1, 1), 1);
        assertEq(pool.acceptProposal(0, 1), 2);
        vm.stopPrank();
        assertEq(pool.contentRefOf(0), bytes32(0));
        assertEq(pool.contentRefOf(1), bytes32(uint256(2)));
        assertEq(pool.contentRefOf(2), REF);
    }

    function test_rejectionRecordsDecisionWithoutProject() public {
        submit();
        vm.expectEmit(true, false, false, true);
        emit PoolBase.ProposalRejected(0);
        vm.prank(owner);
        pool.rejectProposal(0, 1);
        (,,,, PoolBase.ProposalStatus status,) = pool.proposals(0);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Rejected));
        assertEq(pool.projectCount(), 0);
    }

    function test_onlyCurrentOwnerMayReview() public {
        submit();
        vm.startPrank(proposer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, proposer));
        pool.acceptProposal(0, 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, proposer));
        pool.rejectProposal(0, 1);
        vm.stopPrank();
        vm.prank(owner);
        pool.transferOwnership(proposer);
        vm.prank(proposer);
        pool.acceptProposal(0, 1);
    }

    function test_decisionsAreFinal() public {
        submit();
        submit();
        vm.startPrank(owner);
        pool.acceptProposal(0, 1);
        pool.rejectProposal(1, 1);
        for (uint256 id; id < 2; id++) {
            vm.expectRevert(ProposalAlreadyReviewed.selector);
            pool.acceptProposal(id, 1);
            vm.expectRevert(ProposalAlreadyReviewed.selector);
            pool.rejectProposal(id, 1);
        }
        vm.stopPrank();
    }

    function test_invalidSubmissionAndUnknownIds() public {
        vm.expectRevert(EmptyContentReference.selector);
        pool.propose(bytes32(0), 50, recipient);
        vm.expectRevert(ZeroProposalCost.selector);
        pool.propose(REF, 0, recipient);
        vm.expectRevert(ZeroAddress.selector);
        pool.propose(REF, 50, address(0));
        vm.startPrank(owner);
        vm.expectRevert(InvalidProposal.selector);
        pool.acceptProposal(0, 1);
        vm.expectRevert(InvalidProposal.selector);
        pool.rejectProposal(0, 1);
        vm.stopPrank();
    }

    function test_votingClosesSubmissionsAndReviewButPendingCannotBlockOpening() public {
        submit();
        vm.startPrank(owner);
        pool.addProject(50, recipient);
        pool.openVoting();
        vm.expectRevert(WrongPhase.selector);
        pool.acceptProposal(0, 1);
        vm.expectRevert(WrongPhase.selector);
        pool.rejectProposal(0, 1);
        vm.stopPrank();
        vm.expectRevert(WrongPhase.selector);
        pool.propose(REF, 50, recipient);
    }

    function test_deadlineClosesSubmissionAndReviewEvenInSetup() public {
        submit();
        vm.warp(DEADLINE);
        vm.expectRevert(DeadlinePassed.selector);
        pool.propose(REF, 50, recipient);
        vm.startPrank(owner);
        vm.expectRevert(DeadlinePassed.selector);
        pool.acceptProposal(0, 1);
        vm.expectRevert(DeadlinePassed.selector);
        pool.rejectProposal(0, 1);
        vm.stopPrank();
    }

    function test_failedAcceptanceLeavesPendingAndCanBeRejected() public {
        submit();
        vm.startPrank(owner);
        for (uint256 i; i < 255; i++) {
            pool.addProject(1, recipient);
        }
        vm.expectRevert(PBEAR.TooManyProjects.selector);
        pool.acceptProposal(0, 1);
        (,,,, PoolBase.ProposalStatus status,) = pool.proposals(0);
        assertEq(uint256(status), uint256(PoolBase.ProposalStatus.Pending));
        pool.rejectProposal(0, 1);
        vm.stopPrank();
    }

    function test_acceptedProjectCanBeVotedAndPaid() public {
        submit();
        vm.startPrank(owner);
        pool.acceptProposal(0, 1);
        pool.openVoting();
        vm.stopPrank();
        token.mint(address(this), 50);
        token.approve(address(pool), 50);
        pool.contribute(50);
        pool.vote(hex"01");
        vm.warp(DEADLINE);
        pool.startTally();
        pool.run(10);
        pool.claim(0);
        assertEq(token.balanceOf(recipient), 50);
    }

    function testFuzz_contentAndTermsSurviveAcceptance(bytes32 ref, uint128 amount, address to) public {
        vm.assume(ref != bytes32(0) && amount > 0 && to != address(0));
        pool.propose(ref, amount, to);
        vm.prank(owner);
        pool.acceptProposal(0, 1);
        assertEq(pool.contentRefOf(0), ref);
        assertEq(pool.cost(0), amount);
        assertEq(pool.recipientOf(0), to);
    }

    function test_creAndZiskUseSharedReviewAndKeepCostLimits() public {
        bytes memory pk = abi.encodePacked(bytes1(0x02), bytes32(uint256(1)));
        address cre = deployCode(
            "CreRankedShares.sol:CreRankedShares",
            abi.encode(token, owner, DEADLINE, pk, REF, 0, 1 days, address(123), owner, bytes10(0))
        );
        address zisk = deployCode(
            "ZiskRankedShares.sol:ZiskRankedShares",
            abi.encode(token, owner, DEADLINE, pk, REF, 0, 1 days, new MockZiskVerifier(), REF, REF)
        );
        address[2] memory pools = [cre, zisk];
        for (uint256 i; i < pools.length; i++) {
            PoolBase other = PoolBase(pools[i]);
            other.propose(REF, 50, recipient);
            other.propose(REF, uint256(type(uint64).max) + 1, recipient);
            vm.startPrank(owner);
            other.acceptProposal(0, 1);
            vm.expectRevert(SealedPool.CostTooLarge.selector);
            other.acceptProposal(1, 1);
            other.rejectProposal(1, 1);
            other.openVoting();
            vm.stopPrank();
            assertEq(other.contentRefOf(0), REF);
            assertEq(SealedPool(pools[i]).cost(0), 50);
        }
    }
}
