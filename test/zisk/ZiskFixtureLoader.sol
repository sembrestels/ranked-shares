// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SealedPool} from "../../src/SealedPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";

/// @dev Rebuilds a pool from one of the zisk fixtures through the public API, at the
///      fixture's pool address, so `inputsHash` and the committed proof line up. The
///      concrete pool is deployed by the test through `deployAt`; this base only knows
///      it is a `SealedPool`.
abstract contract ZiskFixtureLoader is Test {
    using stdJson for string;

    string internal json;
    MockERC20 internal token;
    MockERC721 internal nft;
    SealedPool internal pool;

    address internal owner = makeAddr("owner");
    address internal org = makeAddr("org");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant DEADLINE = 1_000_000;
    uint64 internal constant ABANDON_GRACE = 7 days;
    uint256 internal constant NFT_TOKEN = 1;

    function loadFixture(string memory name) internal {
        json = vm.readFile(string.concat("reference/vectors/zisk/fixture_", name, ".json"));
    }

    // ---- JSON helpers ----

    function fxUint(string memory key) internal view returns (uint256) {
        return json.readUint(key);
    }

    function fxWord(string memory key) internal view returns (uint256) {
        return uint256(json.readBytes32(key));
    }

    function fxBytes32(string memory key) internal view returns (bytes32) {
        return json.readBytes32(key);
    }

    /// @dev "" marks an absent ballot in the fixtures; stdJson cannot parse an empty hex
    ///      string, so the string is read first.
    function fxBytes(string memory key) internal view returns (bytes memory) {
        string memory s = json.readString(key);
        if (bytes(s).length == 0) return "";
        return json.readBytes(key);
    }

    function fxAddress(string memory key) internal view returns (address) {
        return json.readAddress(key);
    }

    function fxUintArray(string memory key) internal view returns (uint256[] memory) {
        return json.readUintArray(key);
    }

    function fxWords(string memory key) internal view returns (uint256[] memory out) {
        bytes32[] memory b = json.readBytes32Array(key);
        out = new uint256[](b.length);
        for (uint256 i = 0; i < b.length; i++) {
            out[i] = uint256(b[i]);
        }
    }

    function fxCount(string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(prefix, "[", vm.toString(n), "]"))) n++;
    }

    function voterKey(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".voters[", vm.toString(i), "].", field);
    }

    function hasTakeover() internal view returns (bool) {
        return vm.keyExistsJson(json, ".nftTakeover.from");
    }

    function fixtureInputsHash() internal view returns (bytes32) {
        return fxBytes32(".inputsHash");
    }

    /// @dev `using stdJson` is not inherited, so derived tests read the key through this.
    function fxPk() internal view returns (bytes memory) {
        return json.readBytes(".pk");
    }

    // ---- pool construction ----

    function newMocks() internal {
        token = new MockERC20();
        nft = new MockERC721();
    }

    /// @dev Deploys the concrete pool at the fixture address with `ctorArgs` and finishes
    ///      the setup: projects, open voting, org funding.
    function deployAt(string memory artifact, bytes memory ctorArgs) internal {
        vm.warp(1);
        address where = fxAddress(".pool");
        deployCodeTo(artifact, ctorArgs, where);
        pool = SealedPool(where);
        uint256[] memory costs = fxWords(".costs");
        vm.startPrank(owner);
        for (uint256 c = 0; c < costs.length; c++) {
            pool.addProject(costs[c], recipient);
        }
        pool.openVoting();
        vm.stopPrank();
        token.mint(org, type(uint64).max);
        vm.prank(org);
        token.approve(address(pool), type(uint256).max);
    }

    /// @dev The harness at the fixture address; the concrete pools' tests pass their own artifact.
    function deployHarnessFromFixture() internal {
        newMocks();
        deployAt(
            "SealedPoolHarness.sol:SealedPoolHarness",
            abi.encode(token, owner, DEADLINE, fxPk(), fxBytes32(".keySalt"), fxWord(".minDirectVote"), ABANDON_GRACE)
        );
    }

    /// @dev Registration order is what the fixture's voter order says: every deposit path
    ///      registers on first touch, so contributions and seats are granted voter by
    ///      voter, ballots afterwards, the NFT takeover last (its holder must still have
    ///      the seat when it votes), and the dust as unclaimed NFT seats at the very end.
    function replayVoters() internal {
        uint256 n = fxCount(".voters");
        address tFrom;
        address tTo;
        uint256 tAmount;
        if (hasTakeover()) {
            tFrom = fxAddress(".nftTakeover.from");
            tTo = fxAddress(".nftTakeover.to");
            tAmount = fxWord(".nftTakeover.sponsorshipAmount");
        }
        uint256 nftSponsorship;
        uint256 granted;
        for (uint256 i = 0; i < n; i++) {
            address a = fxAddress(voterKey(i, "addr"));
            uint256 direct = fxWord(voterKey(i, "directWeight"));
            uint256 seat = fxWord(voterKey(i, "seatWeight"));
            if (direct > 0) {
                token.mint(a, direct);
                vm.startPrank(a);
                token.approve(address(pool), direct);
                pool.contribute(direct);
                vm.stopPrank();
            }
            if (a == tFrom) {
                vm.prank(org);
                nftSponsorship = pool.sponsorNFT(tAmount, IERC721(address(nft)), 1);
                nft.mint(a, NFT_TOKEN);
                vm.prank(a);
                pool.claimSeat(nftSponsorship, NFT_TOKEN);
                granted += tAmount;
            } else if (seat > 0) {
                uint256 listSeat = a == tTo ? seat - tAmount : seat;
                address[] memory members = new address[](1);
                members[0] = a;
                vm.prank(org);
                pool.sponsor(listSeat, members);
                granted += listSeat;
            }
            granted += direct;
        }
        for (uint256 i = 0; i < n; i++) {
            address a = fxAddress(voterKey(i, "addr"));
            bytes memory ballot = fxBytes(voterKey(i, "directBallot"));
            if (ballot.length != 0) {
                vm.prank(a);
                pool.vote(ballot);
            }
            bytes memory ct = fxBytes(voterKey(i, "ciphertext"));
            if (ct.length != 0) {
                vm.prank(a);
                pool.voteSealed(ct);
            }
        }
        if (tFrom != address(0)) {
            vm.prank(tFrom);
            nft.transferFrom(tFrom, tTo, NFT_TOKEN);
            vm.prank(tTo);
            pool.claimSeat(nftSponsorship, NFT_TOKEN);
        }
        uint256 dust = fxWord(".totalWeight") - granted;
        if (dust > 0) {
            vm.prank(org);
            pool.sponsorNFT(dust, IERC721(address(nft)), dust);
        }
        assertEq(pool.totalWeight(), fxWord(".totalWeight"), "fixture totalWeight");
        assertEq(pool.voterCount(), n, "fixture voter count");
        for (uint256 i = 0; i < n; i++) {
            address a = pool.voters(i);
            assertEq(a, fxAddress(voterKey(i, "addr")), "registration order");
            assertEq(pool.seatWeight(a), fxWord(voterKey(i, "seatWeight")), "seat weight");
            assertEq(pool.directWeight(a), fxWord(voterKey(i, "directWeight")), "direct weight");
        }
    }

    function closeAll(uint256 chunk) internal {
        vm.warp(DEADLINE);
        while (!pool.closed()) pool.close(chunk);
    }
}
