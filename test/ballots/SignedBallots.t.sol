// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignedBallots} from "../../src/ballots/SignedBallots.sol";

/// @dev Stand-in for a Safe: approves a digest when its one owner signed it.
contract OwnedWallet is IERC1271 {
    address immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    function execute(address target, bytes calldata data) external {
        (bool ok,) = target.call(data);
        require(ok);
    }
}

contract SignedBallotsTest is Test {
    SignedBallots ballots;
    uint256 constant PROJECTS = 200;
    address constant SERVER = address(0x5E12);
    bytes32 constant BLOB = bytes32(uint256(0x01) << 248 | 0xb10b);

    function setUp() public {
        ballots = new SignedBallots(uint64(block.timestamp + 1 days), PROJECTS, keccak256("round"), SERVER);
    }

    /// @dev Blob hashes belong to the transaction, so each test attaches its own.
    function attachBlob() internal {
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = BLOB;
        vm.blobhashes(hashes);
    }

    /// @dev Strict ranking of `ranked` projects, different per seed, the rest unranked.
    function ballot(uint256 seed, uint256 ranked) internal pure returns (bytes memory ranks) {
        ranks = new bytes(PROJECTS);
        for (uint256 r; r < ranked; r++) {
            ranks[(seed * 7 + r * 13) % PROJECTS] = bytes1(uint8(r + 1));
        }
    }

    function batch(uint256 n, uint64 nonce, uint256 ranked) internal view returns (SignedBallots.Vote[] memory votes) {
        votes = new SignedBallots.Vote[](n);
        for (uint256 i; i < n; i++) {
            bytes memory ranks = ballot(i + nonce, ranked);
            (bytes32 r, bytes32 vs) = vm.signCompact(1000 + i, ballots.digestOf(nonce, keccak256(ranks)));
            votes[i] = SignedBallots.Vote(nonce, r, vs, ranks);
        }
    }

    /// @dev The same signed votes, as the server would send them next to a blob.
    function hashed(SignedBallots.Vote[] memory votes) internal pure returns (SignedBallots.BlobVote[] memory out) {
        out = new SignedBallots.BlobVote[](votes.length);
        for (uint256 i; i < votes.length; i++) {
            out[i] = SignedBallots.BlobVote(votes[i].nonce, votes[i].r, votes[i].vs, keccak256(votes[i].ballot));
        }
    }

    function test_recordsVoterNonceBallotAndTranscript() public {
        SignedBallots.Vote[] memory votes = batch(2, 1, 10);
        vm.expectEmit();
        emit SignedBallots.BallotRecorded(vm.addr(1000), 1, votes[0].ballot);
        ballots.record(votes);
        assertEq(ballots.nonceOf(vm.addr(1000)), 1);
        assertEq(ballots.nonceOf(vm.addr(1001)), 1);
        assertEq(ballots.recordCount(), 2);
        bytes32 acc =
            keccak256(abi.encode(bytes32(0), vm.addr(1000), uint64(1), keccak256(votes[0].ballot), bytes32(0)));
        acc = keccak256(abi.encode(acc, vm.addr(1001), uint64(1), keccak256(votes[1].ballot), bytes32(0)));
        assertEq(ballots.transcript(), acc);
    }

    function test_sameSignatureWorksOnTheBlobPath() public {
        SignedBallots.Vote[] memory votes = batch(2, 1, 10);
        attachBlob();
        vm.expectEmit();
        emit SignedBallots.BlobBallotRecorded(vm.addr(1000), 1, keccak256(votes[0].ballot), BLOB);
        vm.prank(SERVER);
        ballots.recordBlob(0, hashed(votes));
        assertEq(ballots.nonceOf(vm.addr(1001)), 1);
        bytes32 acc = keccak256(abi.encode(bytes32(0), vm.addr(1000), uint64(1), keccak256(votes[0].ballot), BLOB));
        acc = keccak256(abi.encode(acc, vm.addr(1001), uint64(1), keccak256(votes[1].ballot), BLOB));
        assertEq(ballots.transcript(), acc);
    }

    function test_sameVoteTwiceRevertsOnEitherPath() public {
        SignedBallots.Vote[] memory votes = batch(1, 1, 10);
        ballots.record(votes);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, vm.addr(1000), uint64(1)));
        ballots.record(votes);
        attachBlob();
        SignedBallots.BlobVote[] memory blobVotes = hashed(votes);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, vm.addr(1000), uint64(1)));
        vm.prank(SERVER);
        ballots.recordBlob(0, blobVotes);
    }

    function test_higherNonceReplacesAndLowerReverts() public {
        ballots.record(batch(1, 5, 10));
        ballots.record(batch(1, 6, 10));
        assertEq(ballots.nonceOf(vm.addr(1000)), 6);
        SignedBallots.Vote[] memory old = batch(1, 3, 10);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, vm.addr(1000), uint64(3)));
        ballots.record(old);
    }

    function test_blobPathNeedsTheSubmitterAndABlob() public {
        SignedBallots.BlobVote[] memory votes = hashed(batch(1, 1, 10));
        attachBlob();
        vm.expectRevert(SignedBallots.NotBlobSubmitter.selector);
        ballots.recordBlob(0, votes);
        vm.expectRevert(SignedBallots.NoBlob.selector);
        vm.prank(SERVER);
        ballots.recordBlob(1, votes);
    }

    function test_wrongLengthEmptyBatchAndDeadline() public {
        vm.expectRevert(SignedBallots.NoVotes.selector);
        ballots.record(new SignedBallots.Vote[](0));
        SignedBallots.Vote[] memory votes = batch(1, 1, 10);
        votes[0].ballot = new bytes(PROJECTS - 1);
        vm.expectRevert(SignedBallots.WrongLength.selector);
        ballots.record(votes);
        votes = batch(1, 1, 10);
        vm.warp(ballots.votingDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.record(votes);
        attachBlob();
        SignedBallots.BlobVote[] memory blobVotes = hashed(votes);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        vm.prank(SERVER);
        ballots.recordBlob(0, blobVotes);
    }

    function test_tamperedBallotRecordsAnotherAddress() public {
        SignedBallots.Vote[] memory votes = batch(1, 1, 10);
        votes[0].ballot[0] = 0x63;
        ballots.record(votes);
        assertEq(ballots.nonceOf(vm.addr(1000)), 0);
    }

    function test_contractAccountVotesByCallingDirectly() public {
        OwnedWallet wallet = new OwnedWallet(vm.addr(7));
        bytes memory ranks = ballot(1, 10);
        vm.expectEmit();
        emit SignedBallots.BallotRecorded(address(wallet), 1, ranks);
        wallet.execute(address(ballots), abi.encodeCall(SignedBallots.vote, (1, ranks)));
        assertEq(ballots.nonceOf(address(wallet)), 1);
        assertEq(
            ballots.transcript(),
            keccak256(abi.encode(bytes32(0), address(wallet), uint64(1), keccak256(ranks), bytes32(0)))
        );
        vm.expectRevert();
        wallet.execute(address(ballots), abi.encodeCall(SignedBallots.vote, (1, ranks)));
    }

    function test_contractAccountVotesThroughERC1271() public {
        OwnedWallet wallet = new OwnedWallet(vm.addr(7));
        bytes memory ranks = ballot(1, 10);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(7, ballots.digestOf(1, keccak256(ranks)));
        bytes memory signature = abi.encodePacked(r, s, v);
        ballots.recordFor(address(wallet), 1, ranks, signature);
        assertEq(ballots.nonceOf(address(wallet)), 1);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, address(wallet), uint64(1)));
        ballots.recordFor(address(wallet), 1, ranks, signature);
    }

    function test_recordForRejectsUnapprovedSignaturesAndPlainAccounts() public {
        OwnedWallet wallet = new OwnedWallet(vm.addr(7));
        bytes memory ranks = ballot(1, 10);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(8, ballots.digestOf(1, keccak256(ranks)));
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.recordFor(address(wallet), 1, ranks, signature);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.recordFor(vm.addr(8), 1, ranks, signature);
    }

    // ------------------------------------------------------------------ gas

    function test_gasContractAccounts() public {
        ballots.record(batchFrom(5000, 1, 1, 10));
        OwnedWallet wallet = new OwnedWallet(vm.addr(7));
        bytes memory ranks = ballot(1, 10);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(7, ballots.digestOf(1, keccak256(ranks)));
        uint256 snap = vm.snapshotState();
        emit log_named_uint(
            "recordFor, first vote (mock wallet)",
            txGas(abi.encodeCall(SignedBallots.recordFor, (address(wallet), 1, ranks, abi.encodePacked(r, s, v))))
        );
        vm.revertToState(snap);
        emit log_named_uint(
            "vote(), first vote, called directly", txGas(abi.encodeCall(SignedBallots.vote, (1, ranks)))
        );
    }

    /// @dev Whole-transaction gas: execution from cold storage, plus the 21000 base and
    ///      the calldata charge (EIP-7623 floor applied). Blob gas is not included.
    function txGas(bytes memory data) internal returns (uint256) {
        uint256 zeros;
        for (uint256 i; i < data.length; i++) {
            if (data[i] == 0) zeros++;
        }
        uint256 tokens = zeros + 4 * (data.length - zeros);
        vm.cool(address(ballots));
        attachBlob();
        vm.prank(SERVER);
        uint256 g = gasleft();
        (bool ok,) = address(ballots).call(data);
        uint256 exec = g - gasleft();
        assertTrue(ok);
        uint256 standard = 21000 + 4 * tokens + exec;
        uint256 floor = 21000 + 10 * tokens;
        return standard > floor ? standard : floor;
    }

    function calldataGas(SignedBallots.Vote[] memory votes) internal returns (uint256) {
        return txGas(abi.encodeCall(SignedBallots.record, (votes)));
    }

    function blobGas(SignedBallots.Vote[] memory votes) internal returns (uint256) {
        return txGas(abi.encodeCall(SignedBallots.recordBlob, (0, hashed(votes))));
    }

    /// @dev One batch of `n` votes on each path, on a round that already has records.
    function batchPair(uint256 n, uint256 ranked, string memory label) internal {
        uint256 snap = vm.snapshotState();
        ballots.record(batchFrom(5000, 1, 1, ranked));
        uint256 viaCalldata = calldataGas(batch(n, 1, ranked));
        uint256 replaceCalldata = calldataGas(batch(n, 2, ranked));
        vm.revertToState(snap);
        ballots.record(batchFrom(5000, 1, 1, ranked));
        uint256 viaBlob = blobGas(batch(n, 1, ranked));
        uint256 replaceBlob = blobGas(batch(n, 2, ranked));
        vm.revertToState(snap);
        emit log_string(label);
        emit log_named_uint("  first votes, calldata", viaCalldata);
        emit log_named_uint("  first votes, blob", viaBlob);
        emit log_named_uint("  replacements, calldata", replaceCalldata);
        emit log_named_uint("  replacements, blob", replaceBlob);
    }

    function batchFrom(uint256 key, uint256 n, uint64 nonce, uint256 ranked)
        internal
        view
        returns (SignedBallots.Vote[] memory votes)
    {
        votes = new SignedBallots.Vote[](n);
        for (uint256 i; i < n; i++) {
            bytes memory ranks = ballot(i + nonce, ranked);
            (bytes32 r, bytes32 vs) = vm.signCompact(key + i, ballots.digestOf(nonce, keccak256(ranks)));
            votes[i] = SignedBallots.Vote(nonce, r, vs, ranks);
        }
    }

    function test_gasBatches() public {
        batchPair(1, 10, "1 vote, top 10 ranked");
        batchPair(1, PROJECTS, "1 vote, all ranked");
        batchPair(10, 10, "10 votes, top 10 ranked");
        batchPair(10, PROJECTS, "10 votes, all ranked");
        batchPair(50, 10, "50 votes, top 10 ranked");
        batchPair(50, PROJECTS, "50 votes, all ranked");
        batchPair(200, 10, "200 votes, top 10 ranked");
        batchPair(200, PROJECTS, "200 votes, all ranked");
    }
}
