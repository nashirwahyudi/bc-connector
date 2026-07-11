// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * AuditAnchor — anchors Merkle roots of sales-transaction batches on-chain.
 *
 * Design goals:
 *  - Minimal storage: one root per batch, nothing else.
 *  - Access control: only authorized anchorer addresses can write.
 *  - Immutability: a batchId can never be overwritten (tamper-evidence).
 *  - Events for cheap off-chain indexing.
 */
contract AuditAnchor {
    struct Anchor {
        bytes32 merkleRoot;
        uint64 timestamp;      // block timestamp when anchored
        address anchoredBy;
    }

    address public owner;
    mapping(address => bool) public isAnchorer;
    mapping(uint256 => Anchor) public anchors;   // batchId => Anchor
    uint256 public batchCount;

    event RootAnchored(
        uint256 indexed batchId,
        bytes32 merkleRoot,
        uint64 timestamp,
        address indexed anchoredBy
    );
    event AnchorerUpdated(address indexed account, bool allowed);

    error NotOwner();
    error NotAnchorer();
    error BatchAlreadyAnchored(uint256 batchId);
    error EmptyRoot();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAnchorer() {
        if (!isAnchorer[msg.sender]) revert NotAnchorer();
        _;
    }

    constructor() {
        owner = msg.sender;
        isAnchorer[msg.sender] = true;
        emit AnchorerUpdated(msg.sender, true);
    }

    /// Grant or revoke permission to anchor (e.g. your backend service wallet).
    function setAnchorer(address account, bool allowed) external onlyOwner {
        isAnchorer[account] = allowed;
        emit AnchorerUpdated(account, allowed);
    }

    /// Anchor the Merkle root for a batch. Reverts if the batch already exists,
    /// which guarantees history can never be rewritten.
    function anchorRoot(uint256 batchId, bytes32 merkleRoot) external onlyAnchorer {
        if (merkleRoot == bytes32(0)) revert EmptyRoot();
        if (anchors[batchId].merkleRoot != bytes32(0)) {
            revert BatchAlreadyAnchored(batchId);
        }

        anchors[batchId] = Anchor({
            merkleRoot: merkleRoot,
            timestamp: uint64(block.timestamp),
            anchoredBy: msg.sender
        });
        batchCount++;

        emit RootAnchored(batchId, merkleRoot, uint64(block.timestamp), msg.sender);
    }

    /// Convenience read for verifiers.
    function getRoot(uint256 batchId)
        external
        view
        returns (bytes32 merkleRoot, uint64 timestamp, address anchoredBy)
    {
        Anchor memory a = anchors[batchId];
        return (a.merkleRoot, a.timestamp, a.anchoredBy);
    }

    /// On-chain Merkle proof verification (optional — verification can also be
    /// done fully off-chain; this lets third parties verify trustlessly).
    /// Leaves and pairs are hashed with keccak256; pairs are sorted so proofs
    /// don't need left/right flags.
    function verifyProof(
        uint256 batchId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed = computed <= p
                ? keccak256(abi.encodePacked(computed, p))
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == anchors[batchId].merkleRoot && computed != bytes32(0);
    }
}
