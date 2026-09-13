// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RankedShares} from "../src/RankedShares.sol";
import {PoolBase, UnauthorizedProposalEditor, StaleProposalRevision} from "../src/PoolBase.sol";
import {ProposalPrivacy} from "../src/ProposalPrivacy.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PrivateProposalsTest is Test {
    RankedShares pool;
    ProposalPrivacy privacy;
    address owner = address(0xA);
    address proposer = address(0xB);
    bytes32 constant REF = keccak256("ACT descriptor");
    bytes32 constant KEY = keccak256("independent revision key");
    bytes32 constant NEXT_KEY = keccak256("next revision key");
    bytes constant PUBLIC_KEY = hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    function setUp() public {
        pool = new RankedShares(new MockERC20(), owner, uint64(block.timestamp + 1 days));
        privacy = pool.proposalPrivacy();
        vm.prank(owner);
        privacy.setOrganizerKey(PUBLIC_KEY);
    }

    function submit(bytes32 key) internal returns (uint256) {
        vm.prank(proposer);
        return pool.propose(REF, keccak256(abi.encodePacked(key)), 50, proposer);
    }

    function open(uint256 id, bytes32 key) internal {
        uint256[] memory ids = new uint256[](1);
        bytes32[] memory keys = new bytes32[](1);
        ids[0] = id;
        keys[0] = key;
        vm.prank(owner);
        privacy.openVoting(ids, keys);
    }

    function test_keyRegistrationIsAuthenticatedAndLocksAfterSubmission() public {
        vm.expectRevert(ProposalPrivacy.Unauthorized.selector);
        privacy.setOrganizerKey(PUBLIC_KEY);
        vm.prank(owner);
        vm.expectRevert(ProposalPrivacy.InvalidOrganizerKey.selector);
        privacy.setOrganizerKey(hex"02");
        submit(KEY);
        vm.prank(owner);
        vm.expectRevert(ProposalPrivacy.OrganizerKeyLocked.selector);
        privacy.setOrganizerKey(PUBLIC_KEY);
        assertEq(privacy.organizerPublicKey(), PUBLIC_KEY);
    }

    function test_privateRoundRejectsMissingCommitmentsAndDirectRegistryWrites() public {
        vm.expectRevert(ProposalPrivacy.PrivateProposalsRequired.selector);
        pool.propose(REF, bytes32(0), 50, proposer);
        vm.expectRevert(ProposalPrivacy.Unauthorized.selector);
        privacy.record(0, KEY);
        vm.expectRevert(ProposalPrivacy.Unauthorized.selector);
        privacy.accept(0, 0);
        assertFalse(privacy.started());
    }

    function test_noPrivateSubmissionBeforeOrganizerRegistration() public {
        RankedShares other = new RankedShares(new MockERC20(), owner, uint64(block.timestamp + 1 days));
        vm.expectRevert(ProposalPrivacy.OrganizerKeyRequired.selector);
        other.propose(REF, KEY, 50, proposer);
    }

    function test_acceptanceStaysPrivateAndOpeningRevealsOnlyAcceptedFinalRevision() public {
        submit(KEY);
        vm.prank(proposer);
        pool.editProposal(0, 1, keccak256("new descriptor"), keccak256(abi.encodePacked(NEXT_KEY)), 60, proposer);
        uint256 rejected = submit(keccak256("rejected key"));
        uint256 pending = submit(keccak256("pending key"));
        vm.startPrank(owner);
        // Direct projects need no proposal key, and shift the accepted project's ID.
        pool.addProject(25, owner);
        pool.acceptProposal(0, 2);
        pool.rejectProposal(rejected, 1);
        vm.expectRevert(ProposalPrivacy.InvalidPublication.selector);
        pool.openVoting();
        vm.stopPrank();
        assertEq(privacy.proposalKey(0), bytes32(0));
        assertEq(privacy.projectKey(0), bytes32(0));
        open(0, NEXT_KEY);
        assertTrue(pool.votingOpen());
        assertEq(privacy.proposalKey(0), NEXT_KEY);
        assertEq(privacy.projectKey(0), bytes32(0));
        assertEq(privacy.projectKey(1), NEXT_KEY);
        assertEq(privacy.proposalKey(rejected), bytes32(0));
        assertEq(privacy.proposalKey(pending), bytes32(0));
        assertEq(privacy.acceptedProposals().length, 1);
    }

    function test_wrongOldOrMissingKeysCannotOpenAndRollbackAllPublication() public {
        submit(KEY);
        vm.prank(owner);
        pool.editProposal(0, 1, REF, keccak256(abi.encodePacked(NEXT_KEY)), 50, proposer);
        vm.prank(owner);
        pool.acceptProposal(0, 2);
        vm.expectRevert(ProposalPrivacy.InvalidPublication.selector);
        open(0, KEY);
        vm.prank(owner);
        vm.expectRevert(ProposalPrivacy.InvalidPublication.selector);
        privacy.openVoting(new uint256[](0), new bytes32[](0));
        assertFalse(pool.votingOpen());
        assertFalse(privacy.published());
        assertEq(privacy.proposalKey(0), bytes32(0));
    }

    function test_publicationRejectsDuplicatesOmissionsAndAStaleAcceptedList() public {
        submit(KEY);
        submit(NEXT_KEY);
        vm.startPrank(owner);
        pool.acceptProposal(0, 1);
        pool.acceptProposal(1, 1);
        vm.stopPrank();
        vm.expectRevert(ProposalPrivacy.InvalidPublication.selector);
        open(0, KEY);
        uint256[] memory ids = new uint256[](2);
        bytes32[] memory keys = new bytes32[](2);
        keys[0] = KEY;
        keys[1] = KEY;
        vm.prank(owner);
        vm.expectRevert(ProposalPrivacy.InvalidPublication.selector);
        privacy.openVoting(ids, keys);
        assertEq(privacy.proposalKey(0), bytes32(0));
        ids[1] = 1;
        keys[1] = NEXT_KEY;
        vm.prank(owner);
        privacy.openVoting(ids, keys);
        assertEq(privacy.projectKey(1), NEXT_KEY);
    }

    function test_onlyOrganizerCanPublishAndOldRevisionCannotBeAccepted() public {
        submit(KEY);
        vm.expectRevert(UnauthorizedProposalEditor.selector);
        pool.editProposal(0, 1, REF, keccak256(abi.encodePacked(NEXT_KEY)), 50, proposer);
        vm.prank(owner);
        pool.editProposal(0, 1, REF, keccak256(abi.encodePacked(NEXT_KEY)), 50, proposer);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(StaleProposalRevision.selector, 1, 2));
        pool.acceptProposal(0, 1);
        vm.expectRevert(ProposalPrivacy.Unauthorized.selector);
        privacy.openVoting(new uint256[](0), new bytes32[](0));
    }

    function test_failedPoolOpeningRollsBackPrivacyState() public {
        vm.prank(owner);
        vm.expectRevert(); // no projects
        privacy.openVoting(new uint256[](0), new bytes32[](0));
        assertFalse(privacy.published());
        submit(KEY);
        vm.prank(owner);
        pool.acceptProposal(0, 1);
        vm.warp(pool.votingDeadline());
        vm.expectRevert();
        open(0, KEY);
        assertFalse(privacy.published());
        assertEq(privacy.proposalKey(0), bytes32(0));
    }
}
