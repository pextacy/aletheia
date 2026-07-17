// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AletheiaRegistry
/// @notice On-chain build-provenance registry. Binds a GitHub repository to a
///         project record and seals every push (commit hash + tree hash) into
///         the event log with a consensus timestamp. Commit data lives in
///         events only — storage holds per-project control state.
/// @dev Git SHA-1 object IDs (20 bytes) are left-aligned and zero-padded into
///      bytes32; SHA-256 repos fill all 32 bytes. Both encodings are accepted
///      opaquely — verification happens off-chain against the repository.
contract AletheiaRegistry {
    struct Project {
        address owner;      // registrant; controls attestor, links, seal
        address attestor;   // hot key allowed to attest (may equal owner)
        bytes32 repoHash;   // keccak256(lowercase "github.com/{owner}/{repo}")
        uint64  createdAt;  // block.timestamp at registration
        uint64  sealedAt;   // 0 while unsealed
    }

    mapping(uint256 => Project) public projects;      // projectId => Project
    mapping(bytes32 => uint256) public projectByRepo; // repoHash => projectId (1-based)
    uint256 public projectCount;

    error RepoAlreadyRegistered();
    error UnknownProject();
    error NotOwner();
    error NotAttestor();
    error ProjectSealed();
    error BadInput();

    event ProjectRegistered(
        uint256 indexed projectId,
        address indexed owner,
        address attestor,
        bytes32 repoHash,
        string repoUrl,
        uint64 timestamp
    );
    event Attested(
        uint256 indexed projectId,
        bytes32 indexed commitHash,
        bytes32 treeHash,
        uint64 timestamp
    );
    event ContractLinked(
        uint256 indexed projectId,
        address indexed deployed,
        string label,
        uint64 timestamp
    );
    event AttestorChanged(uint256 indexed projectId, address newAttestor);
    event Sealed(uint256 indexed projectId, uint64 timestamp);

    /// @notice Register a repository as a new project. One project per repo.
    /// @param repoHash keccak256 of the lowercase canonical repo path.
    /// @param repoUrl Human-readable repo URL; travels only in the event.
    /// @param attestor Address allowed to attest pushes for this project.
    function registerProject(bytes32 repoHash, string calldata repoUrl, address attestor)
        external
        returns (uint256 projectId)
    {
        if (repoHash == bytes32(0) || attestor == address(0)) revert BadInput();
        if (projectByRepo[repoHash] != 0) revert RepoAlreadyRegistered();

        projectId = ++projectCount;
        projects[projectId] = Project({
            owner: msg.sender,
            attestor: attestor,
            repoHash: repoHash,
            createdAt: uint64(block.timestamp),
            sealedAt: 0
        });
        projectByRepo[repoHash] = projectId;

        emit ProjectRegistered(projectId, msg.sender, attestor, repoHash, repoUrl, uint64(block.timestamp));
    }

    /// @notice Seal one commit into the project's timeline.
    function attest(uint256 projectId, bytes32 commitHash, bytes32 treeHash) external {
        Project storage p = _project(projectId);
        if (msg.sender != p.attestor) revert NotAttestor();
        if (p.sealedAt != 0) revert ProjectSealed();

        emit Attested(projectId, commitHash, treeHash, uint64(block.timestamp));
    }

    /// @notice Seal a batch of commits (multi-commit push) in one transaction.
    function attestBatch(uint256 projectId, bytes32[] calldata commitHashes, bytes32[] calldata treeHashes)
        external
    {
        Project storage p = _project(projectId);
        if (msg.sender != p.attestor) revert NotAttestor();
        if (p.sealedAt != 0) revert ProjectSealed();
        if (commitHashes.length == 0 || commitHashes.length != treeHashes.length) revert BadInput();

        uint64 ts = uint64(block.timestamp);
        for (uint256 i = 0; i < commitHashes.length; i++) {
            emit Attested(projectId, commitHashes[i], treeHashes[i], ts);
        }
    }

    /// @notice Bind a deployed contract address to the build timeline.
    function linkContract(uint256 projectId, address deployed, string calldata label) external {
        Project storage p = _project(projectId);
        if (msg.sender != p.owner) revert NotOwner();
        if (p.sealedAt != 0) revert ProjectSealed();

        emit ContractLinked(projectId, deployed, label, uint64(block.timestamp));
    }

    /// @notice Rotate the attestation key (e.g. after bridge-key compromise).
    function setAttestor(uint256 projectId, address newAttestor) external {
        Project storage p = _project(projectId);
        if (msg.sender != p.owner) revert NotOwner();
        if (p.sealedAt != 0) revert ProjectSealed();
        if (newAttestor == address(0)) revert BadInput();

        p.attestor = newAttestor;
        emit AttestorChanged(projectId, newAttestor);
    }

    /// @notice Permanently close the record. Every mutation reverts afterwards.
    function seal(uint256 projectId) external {
        Project storage p = _project(projectId);
        if (msg.sender != p.owner) revert NotOwner();
        if (p.sealedAt != 0) revert ProjectSealed();

        p.sealedAt = uint64(block.timestamp);
        emit Sealed(projectId, uint64(block.timestamp));
    }

    function _project(uint256 projectId) private view returns (Project storage p) {
        p = projects[projectId];
        if (p.owner == address(0)) revert UnknownProject();
    }
}
