// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AletheiaRegistry} from "../src/AletheiaRegistry.sol";

contract AletheiaRegistryTest is Test {
    AletheiaRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal attestor = makeAddr("attestor");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant REPO_HASH = keccak256("github.com/pextacy/aletheia");
    string internal constant REPO_URL = "https://github.com/pextacy/aletheia";

    // SHA-1 commit/tree ids: 20 bytes left-aligned, zero-padded.
    bytes32 internal constant COMMIT_SHA1 = bytes32(bytes20(hex"5313dfa0102030405060708090a0b0c0d0e0f001"));
    bytes32 internal constant TREE_SHA1 = bytes32(bytes20(hex"967bb390102030405060708090a0b0c0d0e0f002"));
    // SHA-256 ids fill all 32 bytes.
    bytes32 internal constant COMMIT_SHA256 = keccak256("commit-sha256");
    bytes32 internal constant TREE_SHA256 = keccak256("tree-sha256");

    event ProjectRegistered(
        uint256 indexed projectId,
        address indexed owner,
        address attestor,
        bytes32 repoHash,
        string repoUrl,
        uint64 timestamp
    );
    event Attested(uint256 indexed projectId, bytes32 indexed commitHash, bytes32 treeHash, uint64 timestamp);
    event ContractLinked(uint256 indexed projectId, address indexed deployed, string label, uint64 timestamp);
    event AttestorChanged(uint256 indexed projectId, address newAttestor);
    event Sealed(uint256 indexed projectId, uint64 timestamp);

    function setUp() public {
        registry = new AletheiaRegistry();
    }

    function _register() internal returns (uint256 projectId) {
        vm.prank(owner);
        projectId = registry.registerProject(REPO_HASH, REPO_URL, attestor);
    }

    // ─── registerProject ────────────────────────────────────────────────

    function test_register_storesProjectAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit ProjectRegistered(1, owner, attestor, REPO_HASH, REPO_URL, uint64(block.timestamp));

        uint256 id = _register();

        assertEq(id, 1);
        assertEq(registry.projectCount(), 1);
        assertEq(registry.projectByRepo(REPO_HASH), 1);
        (address o, address a, bytes32 rh, uint64 createdAt, uint64 sealedAt) = registry.projects(1);
        assertEq(o, owner);
        assertEq(a, attestor);
        assertEq(rh, REPO_HASH);
        assertEq(createdAt, uint64(block.timestamp));
        assertEq(sealedAt, 0);
    }

    function test_register_idsAreSequential() public {
        _register();
        vm.prank(stranger);
        uint256 id2 = registry.registerProject(keccak256("github.com/other/repo"), "u", stranger);
        assertEq(id2, 2);
    }

    function test_register_revertsOnDuplicateRepo() public {
        _register();
        vm.expectRevert(AletheiaRegistry.RepoAlreadyRegistered.selector);
        vm.prank(stranger);
        registry.registerProject(REPO_HASH, REPO_URL, stranger);
    }

    function test_register_revertsOnZeroRepoHash() public {
        vm.expectRevert(AletheiaRegistry.BadInput.selector);
        registry.registerProject(bytes32(0), REPO_URL, attestor);
    }

    function test_register_revertsOnZeroAttestor() public {
        vm.expectRevert(AletheiaRegistry.BadInput.selector);
        registry.registerProject(REPO_HASH, REPO_URL, address(0));
    }

    // ─── attest ─────────────────────────────────────────────────────────

    function test_attest_emitsEvent() public {
        uint256 id = _register();
        vm.expectEmit(true, true, false, true);
        emit Attested(id, COMMIT_SHA1, TREE_SHA1, uint64(block.timestamp));
        vm.prank(attestor);
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);
    }

    function test_attest_acceptsSha256Ids() public {
        uint256 id = _register();
        vm.expectEmit(true, true, false, true);
        emit Attested(id, COMMIT_SHA256, TREE_SHA256, uint64(block.timestamp));
        vm.prank(attestor);
        registry.attest(id, COMMIT_SHA256, TREE_SHA256);
    }

    function test_attest_revertsForNonAttestor() public {
        uint256 id = _register();
        vm.expectRevert(AletheiaRegistry.NotAttestor.selector);
        vm.prank(owner); // even the owner may not attest unless it is the attestor
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);
    }

    function test_attest_revertsOnUnknownProject() public {
        vm.expectRevert(AletheiaRegistry.UnknownProject.selector);
        vm.prank(attestor);
        registry.attest(42, COMMIT_SHA1, TREE_SHA1);
    }

    function test_attest_revertsWhenSealed() public {
        uint256 id = _register();
        vm.prank(owner);
        registry.seal(id);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        vm.prank(attestor);
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);
    }

    // ─── attestBatch ────────────────────────────────────────────────────

    function test_attestBatch_emitsPerCommit() public {
        uint256 id = _register();
        bytes32[] memory commits = new bytes32[](3);
        bytes32[] memory trees = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) {
            commits[i] = keccak256(abi.encode("c", i));
            trees[i] = keccak256(abi.encode("t", i));
            vm.expectEmit(true, true, false, true);
            emit Attested(id, commits[i], trees[i], uint64(block.timestamp));
        }
        vm.prank(attestor);
        registry.attestBatch(id, commits, trees);
    }

    function test_attestBatch_revertsOnLengthMismatch() public {
        uint256 id = _register();
        bytes32[] memory commits = new bytes32[](2);
        bytes32[] memory trees = new bytes32[](3);
        vm.expectRevert(AletheiaRegistry.BadInput.selector);
        vm.prank(attestor);
        registry.attestBatch(id, commits, trees);
    }

    function test_attestBatch_revertsOnEmptyArrays() public {
        uint256 id = _register();
        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(AletheiaRegistry.BadInput.selector);
        vm.prank(attestor);
        registry.attestBatch(id, empty, empty);
    }

    function test_attestBatch_revertsForNonAttestor() public {
        uint256 id = _register();
        bytes32[] memory one = new bytes32[](1);
        vm.expectRevert(AletheiaRegistry.NotAttestor.selector);
        vm.prank(stranger);
        registry.attestBatch(id, one, one);
    }

    function test_attestBatch_revertsWhenSealed() public {
        uint256 id = _register();
        vm.prank(owner);
        registry.seal(id);
        bytes32[] memory one = new bytes32[](1);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        vm.prank(attestor);
        registry.attestBatch(id, one, one);
    }

    function testFuzz_attestBatch_sizes(uint8 n) public {
        vm.assume(n > 0);
        uint256 id = _register();
        bytes32[] memory commits = new bytes32[](n);
        bytes32[] memory trees = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            commits[i] = keccak256(abi.encode("fc", i));
            trees[i] = keccak256(abi.encode("ft", i));
        }
        vm.recordLogs();
        vm.prank(attestor);
        registry.attestBatch(id, commits, trees);
        assertEq(vm.getRecordedLogs().length, uint256(n));
    }

    // ─── linkContract ───────────────────────────────────────────────────

    function test_linkContract_emitsEvent() public {
        uint256 id = _register();
        address deployed = makeAddr("deployed");
        vm.expectEmit(true, true, false, true);
        emit ContractLinked(id, deployed, "AletheiaRegistry v1", uint64(block.timestamp));
        vm.prank(owner);
        registry.linkContract(id, deployed, "AletheiaRegistry v1");
    }

    function test_linkContract_revertsForNonOwner() public {
        uint256 id = _register();
        vm.expectRevert(AletheiaRegistry.NotOwner.selector);
        vm.prank(attestor); // attestor is not the owner
        registry.linkContract(id, address(1), "x");
    }

    function test_linkContract_revertsOnUnknownProject() public {
        vm.expectRevert(AletheiaRegistry.UnknownProject.selector);
        vm.prank(owner);
        registry.linkContract(42, address(1), "x");
    }

    function test_linkContract_revertsWhenSealed() public {
        uint256 id = _register();
        vm.startPrank(owner);
        registry.seal(id);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.linkContract(id, address(1), "x");
        vm.stopPrank();
    }

    // ─── setAttestor ────────────────────────────────────────────────────

    function test_setAttestor_rotatesKey() public {
        uint256 id = _register();
        address newAttestor = makeAddr("newAttestor");

        vm.expectEmit(true, false, false, true);
        emit AttestorChanged(id, newAttestor);
        vm.prank(owner);
        registry.setAttestor(id, newAttestor);

        // old key locked out, new key attests
        vm.expectRevert(AletheiaRegistry.NotAttestor.selector);
        vm.prank(attestor);
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);
        vm.prank(newAttestor);
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);
    }

    function test_setAttestor_revertsForNonOwner() public {
        uint256 id = _register();
        vm.expectRevert(AletheiaRegistry.NotOwner.selector);
        vm.prank(stranger);
        registry.setAttestor(id, stranger);
    }

    function test_setAttestor_revertsOnZeroAddress() public {
        uint256 id = _register();
        vm.expectRevert(AletheiaRegistry.BadInput.selector);
        vm.prank(owner);
        registry.setAttestor(id, address(0));
    }

    function test_setAttestor_revertsOnUnknownProject() public {
        vm.expectRevert(AletheiaRegistry.UnknownProject.selector);
        vm.prank(owner);
        registry.setAttestor(42, stranger);
    }

    function test_setAttestor_revertsWhenSealed() public {
        uint256 id = _register();
        vm.startPrank(owner);
        registry.seal(id);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.setAttestor(id, stranger);
        vm.stopPrank();
    }

    // ─── seal ───────────────────────────────────────────────────────────

    function test_seal_setsTimestampAndEmits() public {
        uint256 id = _register();
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, true);
        emit Sealed(id, uint64(block.timestamp));
        vm.prank(owner);
        registry.seal(id);
        (,,,, uint64 sealedAt) = registry.projects(id);
        assertEq(sealedAt, uint64(block.timestamp));
    }

    function test_seal_revertsForNonOwner() public {
        uint256 id = _register();
        vm.expectRevert(AletheiaRegistry.NotOwner.selector);
        vm.prank(attestor);
        registry.seal(id);
    }

    function test_seal_revertsOnUnknownProject() public {
        vm.expectRevert(AletheiaRegistry.UnknownProject.selector);
        vm.prank(owner);
        registry.seal(42);
    }

    function test_seal_revertsIfAlreadySealed() public {
        uint256 id = _register();
        vm.startPrank(owner);
        registry.seal(id);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.seal(id);
        vm.stopPrank();
    }

    // ─── full lifecycle ─────────────────────────────────────────────────

    function test_lifecycle_registerAttestLinkSealThenAllMutationsRevert() public {
        uint256 id = _register();

        vm.startPrank(attestor);
        for (uint256 i = 0; i < 5; i++) {
            registry.attest(id, keccak256(abi.encode("lc", i)), keccak256(abi.encode("lt", i)));
        }
        vm.stopPrank();

        vm.prank(owner);
        registry.linkContract(id, makeAddr("appContract"), "AletheiaRegistry v1");

        vm.prank(owner);
        registry.seal(id);

        // every mutating path now reverts, permanently
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        vm.prank(attestor);
        registry.attest(id, COMMIT_SHA1, TREE_SHA1);

        bytes32[] memory one = new bytes32[](1);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        vm.prank(attestor);
        registry.attestBatch(id, one, one);

        vm.startPrank(owner);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.linkContract(id, address(1), "x");
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.setAttestor(id, stranger);
        vm.expectRevert(AletheiaRegistry.ProjectSealed.selector);
        registry.seal(id);
        vm.stopPrank();

        // sealing one project does not affect another
        vm.prank(stranger);
        uint256 id2 = registry.registerProject(keccak256("github.com/other/repo"), "u", attestor);
        vm.prank(attestor);
        registry.attest(id2, COMMIT_SHA1, TREE_SHA1);
    }
}
