// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ASAJU Agent V5
 * @notice V4 plus on-chain agent ownership. V4 knew which wallet an agent WAS,
 *         but never who OWNED it — so the only way to authorise a proposal
 *         record was MINTER_ROLE (platform pays), and selling the NFT moved a
 *         receipt rather than the agent. V5 fixes both from one registry:
 *
 *         - agentOwner[agentWallet] — the human owner, set at spawn
 *         - transferAgentOwnership() — the marketplace primitive
 *         - recordExecutedProposal() authorised by owner or agent, not the platform
 *         - breedAgents() prepays the offspring's spawn fee into escrow, so
 *           spawnBredAgent() no longer spends the platform's own balance
 *
 * Minting Auth (dual-auth, unchanged from V4):
 *   Mode A — Backend wallet holding MINTER_ROLE signs the mint TX.
 *   Mode B — Spawned agent wallet signs its own mint TX (self-mint only).
 *
 * AgentStats are wallet-scoped (address => AgentStats), NOT token-scoped.
 * One agent accumulates stats across all its NFTs.
 */
contract AsajuAgentV5 is ERC721A, Ownable, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ── Errors ────────────────────────────────────────────────────────────────
    error UnauthorizedMinter(address caller);
    error AgentCanOnlyMintForSelf(address caller, address recipient);
    error NotAgentOwner(address caller, address agentWallet);
    error ProposalAlreadyRecorded(bytes32 proposalHash);

    // ── Fees — adjustable by owner per-chain via setFees() ─────────────────────
    // Defaults match original Mantle launch values (1 MNT spawn / 0.5 MNT provision).
    // Deploy script calls setFees() right after deploy to calibrate for the target
    // chain's native token (e.g. lower ETH amounts on Ethereum Sepolia).
    uint256 public spawnFee = 1 ether;        // total user pays to spawnAgent()/spawnBredAgent()
    uint256 public agentProvision = 0.5 ether; // portion forwarded to the new agent wallet as gas

    uint256 public breedCost = 2 ether; // 2 MNT per breed

    // ── Structs ───────────────────────────────────────────────────────────────

    /**
     * @dev Per-agent statistics. Keyed by agent wallet address.
     *      Combines performance stats (V2) + governance stats + genetic traits (V4).
     */
    struct AgentStats {
        // Performance (V2)
        uint256 totalEvents;
        uint256 currentLevel;
        uint256 totalGasSpent;
        bool    wisdomUnlocked;
        uint256 lastEventTimestamp;
        // Governance (V4)
        uint256 proposalsApproved;
        // Genetic (V4) — address(0) for Genesis agents
        uint256 generation;
        uint256 heritageScore;   // 0–100
        address parent1Wallet;
        address parent2Wallet;
    }

    /**
     * @dev Per-token event metadata stored at mint time.
     */
    struct EventAttendance {
        string  eventTitle;
        string  eventUrl;
        string  platform;
        string  agentName;
        address agentAddress;
        string  summary;
        uint256 timestamp;
        uint256 agentLevel;
        string  niche;
    }

    /**
     * @dev On-chain record of a breeding transaction.
     *      Stores genetic traits so spawnBredAgent() can initialise offspring stats.
     */
    struct BreedRecord {
        address parent1Wallet;
        address parent2Wallet;
        uint256 generation;
        uint256 heritageScore;
        uint256 cost;
        uint256 timestamp;
        address breeder;          // who paid — becomes the offspring's owner
        uint256 prepaidSpawnFee;  // escrowed here, spent by spawnBredAgent()
        bool    spawned;          // guards against double activation
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    mapping(address  => bool)           public isAgentSpawned;
    mapping(address  => address)        public agentOwner;        // agent wallet => human owner
    mapping(address  => bool)           public isApprovedMarketplace;
    mapping(bytes32  => bool)           public proposalRecorded;  // dedupe, see recordExecutedProposal
    mapping(address  => AgentStats)     public agentStats;
    mapping(uint256  => EventAttendance) public tokenIdToEvent;
    mapping(address  => uint256[])      public agentToTokenIds;
    mapping(bytes32  => BreedRecord)    public breedRecords;

    string public baseMetadataURI;
    string public wisdomBadgeURI;

    /// Breed fees held for offspring not yet activated. Never withdrawable.
    uint256 public pendingProvisionEscrow;

    // ── Events ────────────────────────────────────────────────────────────────

    event NFTMinted(
        uint256 indexed tokenId,
        address indexed agentWallet,
        string  eventTitle,
        string  agentName,
        uint256 agentLevel,
        uint256 timestamp
    );

    event AgentLevelUp(
        address indexed agentWallet,
        uint256 newLevel,
        uint256 totalEvents
    );

    event WisdomUnlocked(
        address indexed agentWallet,
        uint256 timestamp
    );

    event AgentSpawned(
        address indexed agentWallet,
        address indexed spawner,
        uint256 generation,
        uint256 provisionAmount,
        uint256 timestamp
    );

    event AgentsBred(
        address indexed user,
        bytes32 indexed offspringKey,
        address parent1Wallet,
        address parent2Wallet,
        uint256 generation,
        uint256 heritageScore,
        uint256 cost
    );

    event AgentOwnershipTransferred(
        address indexed agentWallet,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );

    event ProposalExecuted(
        address indexed agentWallet,
        bytes32 indexed proposalHash,
        uint256 proposalsApprovedTotal,
        uint256 heritageScoreAfter,
        uint256 timestamp
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() ERC721A("ASAJU Agent Proof of Learning", "ASAJU") Ownable(msg.sender) {
        baseMetadataURI = "https://ipfs.io/ipfs/";
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    // ── Role Management ───────────────────────────────────────────────────────

    function grantMinterRole(address minter) external onlyOwner {
        _grantRole(MINTER_ROLE, minter);
    }

    function revokeMinterRole(address minter) external onlyOwner {
        _revokeRole(MINTER_ROLE, minter);
    }

    // ── Agent Spawning ────────────────────────────────────────────────────────

    /**
     * @dev Spawn a Genesis agent (generation = 1).
     *      User pays spawnFee; agentProvision of that is forwarded to the new
     *      agent wallet as gas, the remainder stays in the contract as platform fee.
     */
    function spawnAgent(address agentWallet) external payable {
        require(msg.value >= spawnFee,             "Insufficient spawn fee");
        require(agentWallet != address(0),         "Invalid agent wallet address");
        require(!isAgentSpawned[agentWallet],      "Agent already spawned");

        isAgentSpawned[agentWallet]           = true;
        agentOwner[agentWallet]               = msg.sender;
        agentStats[agentWallet].generation    = 1;
        // parent wallets remain address(0) — Genesis has no parents

        (bool ok, ) = agentWallet.call{value: agentProvision}("");
        require(ok, "Gas provision transfer failed");

        emit AgentSpawned(agentWallet, msg.sender, 1, agentProvision, block.timestamp);
        emit AgentOwnershipTransferred(agentWallet, address(0), msg.sender, block.timestamp);
    }

    /**
     * @dev Spawn a bred offspring agent (generation ≥ 2).
     *      Reads genetic traits from the on-chain BreedRecord and initialises
     *      the offspring's AgentStats. Backend calls this after generating the
     *      offspring's wallet address from the confirmed breedAgents() TX.
     *
     * @param agentWallet  The freshly-generated offspring wallet address.
     * @param offspringId  Must match the offspringId used in breedAgents().
     */
    function spawnBredAgent(address agentWallet, bytes32 offspringId) external {
        require(agentWallet != address(0),     "Invalid agent wallet address");
        require(!isAgentSpawned[agentWallet], "Agent already spawned");

        BreedRecord storage record = breedRecords[offspringId];
        require(record.timestamp > 0, "No breed record found for this offspringId");
        require(!record.spawned,      "Offspring already activated");
        require(
            msg.sender == record.breeder || hasRole(MINTER_ROLE, msg.sender),
            "Only the breeder or the backend may activate this offspring"
        );

        record.spawned = true;
        pendingProvisionEscrow -= record.prepaidSpawnFee;

        isAgentSpawned[agentWallet] = true;
        agentOwner[agentWallet]     = record.breeder;

        AgentStats storage stats = agentStats[agentWallet];
        stats.generation    = record.generation;
        stats.heritageScore = record.heritageScore;
        stats.parent1Wallet = record.parent1Wallet;
        stats.parent2Wallet = record.parent2Wallet;

        (bool ok, ) = agentWallet.call{value: agentProvision}("");
        require(ok, "Gas provision transfer failed");

        emit AgentSpawned(agentWallet, msg.sender, record.generation, agentProvision, block.timestamp);
        emit AgentOwnershipTransferred(agentWallet, address(0), record.breeder, block.timestamp);
    }

    // ── Breeding ──────────────────────────────────────────────────────────────

    /**
     * @dev Records an on-chain breed payment and stores genetic traits.
     *      Backend verifies this tx_hash before creating the offspring in Firestore.
     *      Offspring's wallet address is generated backend-side; later linked via spawnBredAgent().
     *
     * @param parent1Wallet  Wallet address of parent 1.
     * @param parent2Wallet  Wallet address of parent 2.
     * @param offspringId    Deterministic bytes32 ID from backend (keccak256-derived).
     * @param generation     Offspring generation, must be ≥ 2 (backend-calculated).
     * @param heritageScore  Heritage score 0–100 (backend-calculated from parents).
     */
    function breedAgents(
        address parent1Wallet,
        address parent2Wallet,
        bytes32 offspringId,
        uint256 generation,
        uint256 heritageScore
    ) external payable {
        uint256 totalDue = breedCost + spawnFee;  // breed + the offspring's activation, paid once
        require(msg.value >= totalDue,                          "Insufficient value: breedCost + spawnFee required");
        require(parent1Wallet != parent2Wallet,                 "Parents must be different agents");
        require(breedRecords[offspringId].timestamp == 0,       "Offspring already bred on-chain");
        require(generation >= 2,                                "Bred offspring must be generation >= 2");
        require(heritageScore <= 100,                           "Heritage score must be 0-100");

        breedRecords[offspringId] = BreedRecord({
            parent1Wallet: parent1Wallet,
            parent2Wallet: parent2Wallet,
            generation:    generation,
            heritageScore: heritageScore,
            cost:            msg.value,
            timestamp:       block.timestamp,
            breeder:         msg.sender,
            prepaidSpawnFee: spawnFee,
            spawned:         false
        });

        pendingProvisionEscrow += spawnFee;

        emit AgentsBred(
            msg.sender,
            offspringId,
            parent1Wallet,
            parent2Wallet,
            generation,
            heritageScore,
            msg.value
        );

        // Refund any excess above what was due
        if (msg.value > totalDue) {
            payable(msg.sender).transfer(msg.value - totalDue);
        }
    }

    // ── Mint Authorization (Dual-Auth, restored from V2) ─────────────────────

    /**
     * @dev _enforceMintAuth: allows EITHER a MINTER_ROLE wallet (Mode A) OR a
     *      spawned agent wallet (Mode B). In Mode B the agent can only mint to itself.
     */
    function _enforceMintAuth(address recipient) internal view {
        bool isAdminMinter     = hasRole(MINTER_ROLE, msg.sender);
        bool isRegisteredAgent = isAgentSpawned[msg.sender];

        if (!isAdminMinter && !isRegisteredAgent) {
            revert UnauthorizedMinter(msg.sender);
        }
        if (!isAdminMinter && msg.sender != recipient) {
            revert AgentCanOnlyMintForSelf(msg.sender, recipient);
        }
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    /**
     * @dev Mint a single Proof-of-Attendance NFT.
     *      Mode A: backend (MINTER_ROLE) mints for any agent wallet.
     *      Mode B: spawned agent self-mints (msg.sender must equal agentWallet).
     */
    function mintAttendanceNFT(
        address agentWallet,
        string memory eventTitle,
        string memory eventUrl,
        string memory platform,
        string memory agentName,
        string memory summary,
        string memory niche
    ) public returns (uint256) {
        _enforceMintAuth(agentWallet);
        uint256 tokenId = _nextTokenId();
        _safeMint(agentWallet, 1);
        _applyMintSideEffects(agentWallet, tokenId, eventTitle, eventUrl, platform, agentName, summary, niche);
        return tokenId;
    }

    /**
     * @dev Batch mint — gas-optimized via ERC-721A single _safeMint call.
     *      60%+ cheaper than minting individually when attending multiple events.
     */
    function batchMintAttendanceNFTs(
        address agentWallet,
        string[] memory eventTitles,
        string[] memory eventUrls,
        string[] memory platforms,
        string memory   agentName,
        string[] memory summaries,
        string memory   niche
    ) public returns (uint256[] memory) {
        _enforceMintAuth(agentWallet);

        uint256 quantity = eventTitles.length;
        require(quantity > 0, "Must mint at least 1");
        require(
            eventUrls.length == quantity &&
            platforms.length == quantity &&
            summaries.length == quantity,
            "Array length mismatch"
        );

        uint256 startTokenId = _nextTokenId();
        _safeMint(agentWallet, quantity); // Single ERC-721A bulk mint

        uint256[] memory tokenIds = new uint256[](quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startTokenId + i;
            tokenIds[i] = tokenId;
            // Delegate to shared helper to avoid stack-too-deep in loop body
            _applyMintSideEffects(
                agentWallet, tokenId,
                eventTitles[i], eventUrls[i], platforms[i],
                agentName, summaries[i], niche
            );
        }
        return tokenIds;
    }

    /**
     * @dev Private helper shared by mintAttendanceNFT and batchMintAttendanceNFTs.
     *      Handles stat updates, storage writes, and event emissions per token.
     */
    function _applyMintSideEffects(
        address agentWallet,
        uint256 tokenId,
        string memory eventTitle,
        string memory eventUrl,
        string memory platform,
        string memory agentName,
        string memory summary,
        string memory niche
    ) private {
        AgentStats storage stats = agentStats[agentWallet];
        stats.totalEvents++;
        stats.lastEventTimestamp = block.timestamp;

        uint256 newLevel = (stats.totalEvents / 2) + 1;
        if (newLevel > stats.currentLevel) {
            stats.currentLevel = newLevel;
            emit AgentLevelUp(agentWallet, newLevel, stats.totalEvents);
        }
        if (stats.totalEvents >= 5 && !stats.wisdomUnlocked) {
            stats.wisdomUnlocked = true;
            emit WisdomUnlocked(agentWallet, block.timestamp);
        }

        tokenIdToEvent[tokenId] = EventAttendance({
            eventTitle:   eventTitle,
            eventUrl:     eventUrl,
            platform:     platform,
            agentName:    agentName,
            agentAddress: agentWallet,
            summary:      summary,
            timestamp:    block.timestamp,
            agentLevel:   stats.currentLevel,
            niche:        niche
        });
        agentToTokenIds[agentWallet].push(tokenId);

        emit NFTMinted(tokenId, agentWallet, eventTitle, agentName, stats.currentLevel, block.timestamp);
    }

    // ── Human-in-the-Loop: Proposal Recording ────────────────────────────────

    /**
     * @dev Records a user-approved proposal execution.
     *      Authorised by the agent's owner, the agent itself (Mode B), or
     *      MINTER_ROLE as a fallback — so gas comes from the owner or the
     *      agent's own wallet rather than a platform-funded minter.
     *      Each proposalHash counts once, so heritage cannot be farmed by
     *      replaying the same approval.
     *
     * @param agentWallet   The agent whose proposal was approved by the human owner.
     * @param proposalHash  keccak256 of the proposal payload (for on-chain auditability).
     */
    function recordExecutedProposal(address agentWallet, bytes32 proposalHash)
        external
    {
        if (
            msg.sender != agentOwner[agentWallet] &&
            msg.sender != agentWallet &&
            !hasRole(MINTER_ROLE, msg.sender)
        ) {
            revert NotAgentOwner(msg.sender, agentWallet);
        }
        if (proposalRecorded[proposalHash]) revert ProposalAlreadyRecorded(proposalHash);
        proposalRecorded[proposalHash] = true;

        AgentStats storage stats = agentStats[agentWallet];
        stats.proposalsApproved++;

        uint256 newScore = stats.heritageScore + 5;
        stats.heritageScore = newScore > 100 ? 100 : newScore;

        emit ProposalExecuted(
            agentWallet,
            proposalHash,
            stats.proposalsApproved,
            stats.heritageScore,
            block.timestamp
        );
    }

    // ── Agent Ownership (marketplace primitive) ──────────────────────────────

    /**
     * @dev Move an agent to a new owner. Everything the agent has earned —
     *      stats, level, heritage, its wallet and the NFTs that wallet holds —
     *      stays with the agent; only the owner changes. Off-chain, the backend
     *      watches AgentOwnershipTransferred to rebind the agent and clear the
     *      previous owner's private context.
     *
     *      Callable by the current owner, or by an approved marketplace contract
     *      so a sale can settle payment and transfer atomically.
     */
    function transferAgentOwnership(address agentWallet, address newOwner) external {
        require(isAgentSpawned[agentWallet], "Agent not spawned");
        require(newOwner != address(0),      "Invalid new owner");

        address currentOwner = agentOwner[agentWallet];
        if (msg.sender != currentOwner && !isApprovedMarketplace[msg.sender]) {
            revert NotAgentOwner(msg.sender, agentWallet);
        }

        agentOwner[agentWallet] = newOwner;
        emit AgentOwnershipTransferred(agentWallet, currentOwner, newOwner, block.timestamp);
    }

    /// @dev Allow-list a marketplace contract to settle agent sales.
    function setMarketplaceApproval(address marketplace, bool approved) external onlyOwner {
        require(marketplace != address(0), "Invalid marketplace address");
        isApprovedMarketplace[marketplace] = approved;
    }

    // ── Gas Tracking ──────────────────────────────────────────────────────────

    /**
     * @dev Record gas spent by an agent (called by backend after autonomous TX).
     *      Used to build the on-chain Agency Score.
     */
    function recordGasSpent(address agentWallet, uint256 gasAmount)
        external
        onlyRole(MINTER_ROLE)
    {
        agentStats[agentWallet].totalGasSpent += gasAmount;
    }

    // ── Dynamic Token URI (restored from V2) ─────────────────────────────────

    /**
     * @dev Returns different metadata URIs based on the agent's current level/wisdom.
     *      Metadata evolves as the agent levels up — the NFT art changes dynamically.
     *
     *      Wisdom tier  (wisdomUnlocked)    → wisdomBadgeURI
     *      Elite tier   (level ≥ 5)         → baseMetadataURI/elite/
     *      Advanced tier(level ≥ 3)         → baseMetadataURI/advanced/
     *      Standard     (level 1–2)         → baseMetadataURI/standard/
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");

        EventAttendance memory attendance = tokenIdToEvent[tokenId];
        AgentStats memory stats = agentStats[attendance.agentAddress];

        if (stats.wisdomUnlocked && bytes(wisdomBadgeURI).length > 0) {
            return string(abi.encodePacked(wisdomBadgeURI, "/", tokenId.toString(), "-wisdom.json"));
        }
        if (stats.currentLevel >= 5) {
            return string(abi.encodePacked(baseMetadataURI, "/elite/", tokenId.toString(), ".json"));
        }
        if (stats.currentLevel >= 3) {
            return string(abi.encodePacked(baseMetadataURI, "/advanced/", tokenId.toString(), ".json"));
        }
        return string(abi.encodePacked(baseMetadataURI, "/standard/", tokenId.toString(), ".json"));
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function getAgentStats(address agentWallet)
        external view returns (AgentStats memory)
    {
        return agentStats[agentWallet];
    }

    function getAgentTokenIds(address agentWallet)
        external view returns (uint256[] memory)
    {
        return agentToTokenIds[agentWallet];
    }

    function getEventDetails(uint256 tokenId)
        external view returns (EventAttendance memory)
    {
        require(_exists(tokenId), "Token does not exist");
        return tokenIdToEvent[tokenId];
    }

    function getBreedRecord(bytes32 offspringId)
        external view returns (BreedRecord memory)
    {
        return breedRecords[offspringId];
    }

    function getAgentOwner(address agentWallet)
        external view returns (address)
    {
        return agentOwner[agentWallet];
    }

    function isAgentActive(address agentWallet)
        external view returns (bool)
    {
        return isAgentSpawned[agentWallet] && agentWallet.balance > 0;
    }

    function getTotalMinted()
        external view returns (uint256)
    {
        return _nextTokenId() - _startTokenId();
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setBaseMetadataURI(string memory newBaseURI) external onlyOwner {
        baseMetadataURI = newBaseURI;
    }

    function setWisdomBadgeURI(string memory newWisdomURI) external onlyOwner {
        wisdomBadgeURI = newWisdomURI;
    }

    function setBreedCost(uint256 newCost) external onlyOwner {
        breedCost = newCost;
    }

    /**
     * @dev Calibrate spawn economics for this chain's native token.
     *      Called once by the deployer right after deploy (see deploy-new-chain.js).
     *      Atomic — avoids a transient state where agentProvision > spawnFee,
     *      which would make spawnAgent()/spawnBredAgent() revert for every caller.
     */
    function setFees(uint256 newSpawnFee, uint256 newProvision) external onlyOwner {
        require(newProvision <= newSpawnFee, "Provision cannot exceed spawn fee");
        spawnFee = newSpawnFee;
        agentProvision = newProvision;
    }

    /**
     * @dev Withdraw accumulated platform fees (spawn fees + breed fees).
     *      Breed fees + (spawnFee - agentProvision) per spawn accumulate in this contract.
     */
    function withdrawPlatformFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > pendingProvisionEscrow, "No fees to withdraw");
        uint256 withdrawable = balance - pendingProvisionEscrow;
        (bool ok, ) = owner().call{value: withdrawable}("");
        require(ok, "Withdrawal failed");
    }

    // ── Interface Support ─────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721A, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
