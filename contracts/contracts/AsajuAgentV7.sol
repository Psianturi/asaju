// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/interfaces/IERC4906.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @dev Read surface shared by MAEFNFTV4 (Mantle) and AsajuAgentV6.
interface ILegacyAgent {
    struct Stats {
        uint256 totalEvents;
        uint256 currentLevel;
        uint256 totalGasSpent;
        bool    wisdomUnlocked;
        uint256 lastEventTimestamp;
        uint256 proposalsApproved;
        uint256 generation;
        uint256 heritageScore;
        address parent1Wallet;
        address parent2Wallet;
    }
    function getAgentStats(address agentWallet) external view returns (Stats memory);
    function isAgentSpawned(address agentWallet) external view returns (bool);
    function agentOwner(address agentWallet) external view returns (address);                 // V6 only
    function transferAgentOwnership(address agentWallet, address newOwner) external;          // V6 only
}

/**
 * @title ASAJU Agent V7 — Agent Passport
 * @notice Every agent is one ERC-721 token, tokenId = uint160(agentWallet).
 *         ownerOf() is the agent's owner; no admin function can change it.
 *         Lessons are records, not tokens. Admin = a TimelockController.
 */
contract AsajuAgentV7 is ERC721, IERC2981, IERC4906, Ownable, Pausable, ReentrancyGuard, EIP712 {
    using Strings for uint256;
    using Strings for address;

    // ── Types ────────────────────────────────────────────────────────────────

    enum LegacyKind { None, V6, V4 }

    /// @dev Same layout as V4/V6 getAgentStats(), so existing decoders keep working.
    ///      totalEvents counts lessons; totalGasSpent is always 0 (recordGasSpent is gone).
    struct AgentStats {
        uint256 totalEvents;
        uint256 currentLevel;
        uint256 totalGasSpent;
        bool    wisdomUnlocked;
        uint256 lastEventTimestamp;
        uint256 proposalsApproved;
        uint256 generation;
        uint256 heritageScore;
        address parent1Wallet;
        address parent2Wallet;
    }

    struct BreedRecord {
        address parentA;
        address parentB;
        address breeder;
        uint64  timestamp;
        uint32  generation;
        uint8   heritageScore;
        bool    spawned;
        uint128 prepaidProvision;
    }

    struct Decision {
        bytes32 commitment;
        uint64  committedAt;
        uint64  revealedAt;
    }

    struct InitParams {
        address admin;               // TimelockController
        address guardian;            // may pause; typically the multisig
        uint256 spawnFee;
        uint256 agentProvision;
        uint256 breedCost;
        uint16  royaltyBps;
        address legacy;              // V6 or V4 on this chain, or address(0)
        LegacyKind legacyKind;
        address migrationSigner;     // V4 attestations only
        uint64  migrationWindow;     // seconds from deploy; V4 attestations only
        string  imageBaseURI;
        string  chainLabel;
    }

    // ── Constants ────────────────────────────────────────────────────────────

    uint16  public constant MAX_ROYALTY_BPS = 1000;   // 10%
    uint256 public constant WISDOM_LESSONS  = 5;
    uint256 public constant MAX_LABEL_BYTES = 32;
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("LegacyClaim(address agentWallet,address owner,uint256 deadline)");
    bytes32 private constant SPAWN_TYPEHASH =
        keccak256("SpawnConsent(address agentWallet,address owner)");

    // ── Storage ──────────────────────────────────────────────────────────────

    uint256 public spawnFee;
    uint256 public agentProvision;
    uint256 public breedCost;
    uint16  public royaltyBps;
    uint64  public breedCooldown = 1 days;
    uint8   public maxBreedsPerAgent = 3;
    uint256 public minLevelToBreed = 1;
    uint256 public minAgentBalanceForExecution;

    /// Provision prepaid by breeders for offspring not yet activated. Never withdrawable.
    uint256 public pendingProvisionEscrow;
    uint256 public totalPassports;

    address public guardian;
    string  public imageBaseURI;
    string  public chainLabel;

    ILegacyAgent public immutable legacy;
    LegacyKind   public immutable legacyKind;
    address public migrationSigner;
    uint64  public migrationDeadline;
    bool    public migrationClosed;

    mapping(address => bool)          public isAgentSpawned;
    mapping(address => bool)          public migrated;
    mapping(uint256 => address)       public creatorOf;
    mapping(uint256 => uint256)       public ownershipNonce;   // bumps on every transfer
    mapping(address => AgentStats)    private _stats;
    mapping(address => string)        public agentName;
    mapping(address => string)        public agentNiche;
    mapping(address => bytes32[])     private _lessons;
    mapping(address => Decision[])    private _decisions;
    mapping(bytes32 => BreedRecord)   public breedRecords;
    mapping(address => uint64)        public lastBredAt;
    mapping(address => uint8)         public breedCount;
    mapping(bytes32 => bool)          public proposalRecorded;

    // ── Events ───────────────────────────────────────────────────────────────

    // Same signatures as V6 so the backend's parsers and indexer keep working.
    event AgentSpawned(address indexed agentWallet, address indexed spawner, uint256 generation, uint256 provisionAmount, uint256 timestamp);
    event AgentsBred(address indexed user, bytes32 indexed offspringKey, address parent1Wallet, address parent2Wallet, uint256 generation, uint256 heritageScore, uint256 cost);
    event AgentOwnershipTransferred(address indexed agentWallet, address indexed previousOwner, address indexed newOwner, uint256 timestamp);
    event AgentLevelUp(address indexed agentWallet, uint256 newLevel, uint256 totalEvents);
    event WisdomUnlocked(address indexed agentWallet, uint256 timestamp);
    event ProposalExecuted(address indexed agentWallet, bytes32 indexed proposalHash, uint256 proposalsApprovedTotal, uint256 heritageScoreAfter, uint256 timestamp);

    event LessonRecorded(uint256 indexed tokenId, uint256 indexed index, bytes32 contentHash, string uri, uint256 timestamp);
    event DecisionCommitted(uint256 indexed tokenId, uint256 indexed id, bytes32 commitment, address committer, uint256 timestamp);
    event DecisionRevealed(uint256 indexed tokenId, uint256 indexed id, bytes payload, uint256 timestamp);
    event LegacyClaimed(address indexed agentWallet, address indexed owner, LegacyKind kind, uint256 lessons);
    event ProfileUpdated(address indexed agentWallet, string name, string niche);
    event FeesUpdated(uint256 spawnFee, uint256 agentProvision, uint256 breedCost);
    event RoyaltyUpdated(uint16 royaltyBps);
    event GuardianUpdated(address guardian);
    event MigrationSignerUpdated(address signer);
    event MigrationClosed();

    // ── Errors ───────────────────────────────────────────────────────────────

    error InvalidAddress();
    error WrongPayment(uint256 expected, uint256 sent);
    error AlreadySpawned(address agentWallet);
    error NotSpawned(address agentWallet);
    error NotAuthorized(address caller);
    error NotParentOwner(address parent);
    error BreedNotAllowed(address parent);
    error UnknownOffspring(bytes32 offspringId);
    error OffspringAlreadySpawned(bytes32 offspringId);
    error OffspringIdTaken(bytes32 offspringId);
    error AlreadyRecorded(bytes32 hash);
    error BalanceBelowMinimum();
    error BadCommitment();
    error UnknownDecision(uint256 id);
    error AlreadyRevealed(uint256 id);
    error InvalidLabel();
    error ValueTooHigh();
    error ProvisionExceedsFee();
    error MigrationUnavailable();
    error NotLegacyOwner();
    error LegacyFreezeFailed();
    error SignatureExpired();
    error BadSignature();
    error TransferFailed();
    error NoFees();
    error ReservedForMigration(address agentWallet);

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotAuthorized(msg.sender);
        _;
    }

    constructor(InitParams memory p)
        ERC721("ASAJU Agent Passport", "ASAJU")
        Ownable(p.admin)
        EIP712("AsajuAgentV7", "1")
    {
        if (p.agentProvision > p.spawnFee) revert ProvisionExceedsFee();
        if (p.royaltyBps > MAX_ROYALTY_BPS) revert ValueTooHigh();
        if ((p.legacyKind == LegacyKind.None) != (p.legacy == address(0))) revert InvalidAddress();
        spawnFee = p.spawnFee;
        agentProvision = p.agentProvision;
        breedCost = p.breedCost;
        royaltyBps = p.royaltyBps;
        guardian = p.guardian;
        legacy = ILegacyAgent(p.legacy);
        legacyKind = p.legacyKind;
        imageBaseURI = p.imageBaseURI;
        chainLabel = p.chainLabel;
        if (p.legacyKind == LegacyKind.V4) {
            migrationSigner = p.migrationSigner;
            migrationDeadline = uint64(block.timestamp) + p.migrationWindow;
        }
    }

    // ── Identity ─────────────────────────────────────────────────────────────

    function tokenIdOf(address agentWallet) public pure returns (uint256) {
        return uint256(uint160(agentWallet));
    }

    function agentWalletOf(uint256 tokenId) public pure returns (address) {
        return address(uint160(tokenId));
    }

    /// @notice V5/V6-compatible owner view. address(0) when no Passport exists.
    function agentOwner(address agentWallet) public view returns (address) {
        return _ownerOf(tokenIdOf(agentWallet));
    }

    // ── Spawn & breed ────────────────────────────────────────────────────────

    /// @param agentSig  The agent wallet's EIP-712 SpawnConsent(agentWallet, msg.sender).
    ///                  Stops anyone squatting a wallet they do not control.
    function spawnAgent(address agentWallet, bytes calldata agentSig) external payable whenNotPaused nonReentrant returns (uint256 tokenId) {
        if (msg.value != spawnFee) revert WrongPayment(spawnFee, msg.value);
        _checkSpawnConsent(agentWallet, msg.sender, agentSig);
        tokenId = _register(agentWallet, msg.sender, 1, 0, address(0), address(0));
        _sendValue(agentWallet, agentProvision);
        emit AgentSpawned(agentWallet, msg.sender, 1, agentProvision, block.timestamp);
        _safeMint(msg.sender, tokenId);
    }

    function breedAgents(address parentA, address parentB, bytes32 offspringId) external payable whenNotPaused nonReentrant {
        uint256 due = breedCost + spawnFee;
        if (msg.value != due) revert WrongPayment(due, msg.value);
        if (parentA == parentB) revert BreedNotAllowed(parentB);
        if (breedRecords[offspringId].timestamp != 0) revert OffspringIdTaken(offspringId);
        _checkParent(parentA);
        _checkParent(parentB);

        AgentStats storage a = _stats[parentA];
        AgentStats storage b = _stats[parentB];
        uint256 generation = (a.generation > b.generation ? a.generation : b.generation) + 1;
        uint256 heritage = (a.heritageScore + b.heritageScore) / 2;

        breedRecords[offspringId] = BreedRecord({
            parentA: parentA,
            parentB: parentB,
            breeder: msg.sender,
            timestamp: uint64(block.timestamp),
            generation: uint32(generation),
            heritageScore: uint8(heritage),
            spawned: false,
            prepaidProvision: uint128(agentProvision)
        });
        pendingProvisionEscrow += agentProvision;

        emit AgentsBred(msg.sender, offspringId, parentA, parentB, generation, heritage, msg.value);
    }

    function _checkParent(address parent) private {
        if (_ownerOf(tokenIdOf(parent)) != msg.sender) revert NotParentOwner(parent);
        if (
            breedCount[parent] >= maxBreedsPerAgent ||
            (lastBredAt[parent] != 0 && block.timestamp < lastBredAt[parent] + breedCooldown) ||
            _stats[parent].currentLevel < minLevelToBreed
        ) revert BreedNotAllowed(parent);
        breedCount[parent] += 1;
        lastBredAt[parent] = uint64(block.timestamp);
    }

    /// @notice Activates a bred offspring. Only the breeder; the Passport goes to the breeder.
    function spawnBredAgent(address agentWallet, bytes32 offspringId, bytes calldata agentSig) external whenNotPaused nonReentrant returns (uint256 tokenId) {
        BreedRecord storage r = breedRecords[offspringId];
        if (r.timestamp == 0) revert UnknownOffspring(offspringId);
        if (r.spawned) revert OffspringAlreadySpawned(offspringId);
        if (msg.sender != r.breeder) revert NotAuthorized(msg.sender);
        _checkSpawnConsent(agentWallet, r.breeder, agentSig);

        r.spawned = true;
        uint256 provision = r.prepaidProvision;
        pendingProvisionEscrow -= provision;

        tokenId = _register(agentWallet, r.breeder, r.generation, r.heritageScore, r.parentA, r.parentB);
        _sendValue(agentWallet, provision);
        emit AgentSpawned(agentWallet, msg.sender, r.generation, provision, block.timestamp);
        _safeMint(r.breeder, tokenId);
    }

    function _checkSpawnConsent(address agentWallet, address owner_, bytes calldata agentSig) private view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SPAWN_TYPEHASH, agentWallet, owner_)));
        if (ECDSA.recover(digest, agentSig) != agentWallet) revert BadSignature();
        // Wallets of the legacy contract can only arrive here through migration.
        if (address(legacy) != address(0) && legacy.isAgentSpawned(agentWallet)) revert ReservedForMigration(agentWallet);
    }

    function _register(
        address agentWallet,
        address creator,
        uint256 generation,
        uint256 heritage,
        address parentA,
        address parentB
    ) private returns (uint256 tokenId) {
        if (agentWallet == address(0)) revert InvalidAddress();
        if (isAgentSpawned[agentWallet]) revert AlreadySpawned(agentWallet);
        isAgentSpawned[agentWallet] = true;
        tokenId = tokenIdOf(agentWallet);
        creatorOf[tokenId] = creator;
        totalPassports += 1;

        AgentStats storage s = _stats[agentWallet];
        s.currentLevel = 1;
        s.generation = generation;
        s.heritageScore = heritage;
        s.parent1Wallet = parentA;
        s.parent2Wallet = parentB;
    }

    // ── Lessons (Proof of Learning) ──────────────────────────────────────────

    /// @notice Only the agent's own wallet records its lessons.
    function recordLesson(address agentWallet, bytes32 contentHash, string calldata uri) external returns (uint256 index) {
        if (msg.sender != agentWallet) revert NotAuthorized(msg.sender);
        if (!isAgentSpawned[agentWallet]) revert NotSpawned(agentWallet);

        index = _lessons[agentWallet].length;
        _lessons[agentWallet].push(contentHash);

        AgentStats storage s = _stats[agentWallet];
        s.totalEvents += 1;
        s.lastEventTimestamp = block.timestamp;
        _refreshLevel(agentWallet, s);

        uint256 tokenId = tokenIdOf(agentWallet);
        emit LessonRecorded(tokenId, index, contentHash, uri, block.timestamp);
        emit MetadataUpdate(tokenId);
    }

    /// @dev Frozen formula: level = lessons / 2 + 1, wisdom at 5 lessons.
    function _refreshLevel(address agentWallet, AgentStats storage s) private {
        uint256 level = s.totalEvents / 2 + 1;
        if (level > s.currentLevel) {
            s.currentLevel = level;
            emit AgentLevelUp(agentWallet, level, s.totalEvents);
        }
        if (!s.wisdomUnlocked && s.totalEvents >= WISDOM_LESSONS) {
            s.wisdomUnlocked = true;
            emit WisdomUnlocked(agentWallet, block.timestamp);
        }
    }

    // ── Proposals (kept from V6 for the approval flow) ───────────────────────

    function recordExecutedProposal(address agentWallet, bytes32 proposalHash) external {
        if (msg.sender != agentWallet && msg.sender != agentOwner(agentWallet)) revert NotAuthorized(msg.sender);
        if (!isAgentSpawned[agentWallet]) revert NotSpawned(agentWallet);
        if (proposalRecorded[proposalHash]) revert AlreadyRecorded(proposalHash);
        if (agentWallet.balance < minAgentBalanceForExecution) revert BalanceBelowMinimum();
        proposalRecorded[proposalHash] = true;

        AgentStats storage s = _stats[agentWallet];
        s.proposalsApproved += 1;
        s.heritageScore = s.heritageScore + 5 > 100 ? 100 : s.heritageScore + 5;
        emit ProposalExecuted(agentWallet, proposalHash, s.proposalsApproved, s.heritageScore, block.timestamp);
    }

    // ── Verifiable track record ──────────────────────────────────────────────

    /// @notice commitment = keccak256(abi.encode(agentWallet, payload, salt)).
    function commitDecision(address agentWallet, bytes32 commitment) external whenNotPaused returns (uint256 id) {
        if (msg.sender != agentWallet && msg.sender != agentOwner(agentWallet)) revert NotAuthorized(msg.sender);
        if (!isAgentSpawned[agentWallet]) revert NotSpawned(agentWallet);
        if (commitment == bytes32(0)) revert BadCommitment();
        id = _decisions[agentWallet].length;
        _decisions[agentWallet].push(Decision(commitment, uint64(block.timestamp), 0));
        emit DecisionCommitted(tokenIdOf(agentWallet), id, commitment, msg.sender, block.timestamp);
    }

    /// @notice Anyone holding payload and salt may reveal; the hash decides.
    function revealDecision(address agentWallet, uint256 id, bytes calldata payload, bytes32 salt) external {
        if (id >= _decisions[agentWallet].length) revert UnknownDecision(id);
        Decision storage d = _decisions[agentWallet][id];
        if (d.revealedAt != 0) revert AlreadyRevealed(id);
        if (keccak256(abi.encode(agentWallet, payload, salt)) != d.commitment) revert BadCommitment();
        d.revealedAt = uint64(block.timestamp);
        emit DecisionRevealed(tokenIdOf(agentWallet), id, payload, block.timestamp);
    }

    // ── Profile (name / niche shown in metadata) ─────────────────────────────

    function setProfile(address agentWallet, string calldata name_, string calldata niche_) external {
        if (msg.sender != agentWallet && msg.sender != agentOwner(agentWallet)) revert NotAuthorized(msg.sender);
        if (!isAgentSpawned[agentWallet]) revert NotSpawned(agentWallet);
        _checkLabel(name_);
        _checkLabel(niche_);
        agentName[agentWallet] = name_;
        agentNiche[agentWallet] = niche_;
        emit ProfileUpdated(agentWallet, name_, niche_);
        emit MetadataUpdate(tokenIdOf(agentWallet));
    }

    /// @dev Printable ASCII without quote or backslash, so it embeds in JSON as-is.
    function _checkLabel(string calldata s) private pure {
        bytes calldata b = bytes(s);
        if (b.length > MAX_LABEL_BYTES) revert InvalidLabel();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c < 0x20 || c > 0x7e || c == '"' || c == "\\") revert InvalidLabel();
        }
    }

    // ── Migration ────────────────────────────────────────────────────────────

    /// @notice V6 → V7 on the same chain, trustless. Freezes the V6 record under
    ///         this contract first. Needs V6.setMarketplaceApproval(this, true).
    function claimLegacy(address agentWallet) external whenNotPaused nonReentrant returns (uint256) {
        if (legacyKind != LegacyKind.V6) revert MigrationUnavailable();
        if (legacy.agentOwner(agentWallet) != msg.sender) revert NotLegacyOwner();
        legacy.transferAgentOwnership(agentWallet, address(this));
        if (legacy.agentOwner(agentWallet) != address(this)) revert LegacyFreezeFailed();
        return _importLegacy(agentWallet, msg.sender);
    }

    /// @notice Mantle V4 → V7. V4 has no on-chain owner, so the migration key
    ///         attests (agentWallet, owner); the owner submits it. Stats are read
    ///         from V4 on-chain. Window-limited, once per agent.
    function claimWithAttestation(address agentWallet, uint256 deadline, bytes calldata signature)
        external whenNotPaused nonReentrant returns (uint256)
    {
        if (legacyKind != LegacyKind.V4 || migrationClosed || migrationSigner == address(0)) revert MigrationUnavailable();
        if (block.timestamp > deadline || block.timestamp > migrationDeadline) revert SignatureExpired();
        if (!legacy.isAgentSpawned(agentWallet)) revert NotSpawned(agentWallet);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, agentWallet, msg.sender, deadline)));
        if (ECDSA.recover(digest, signature) != migrationSigner) revert BadSignature();
        return _importLegacy(agentWallet, msg.sender);
    }

    function _importLegacy(address agentWallet, address owner_) private returns (uint256 tokenId) {
        ILegacyAgent.Stats memory old = legacy.getAgentStats(agentWallet);
        tokenId = _register(agentWallet, owner_, old.generation == 0 ? 1 : old.generation, old.heritageScore > 100 ? 100 : old.heritageScore, old.parent1Wallet, old.parent2Wallet);
        migrated[agentWallet] = true;

        AgentStats storage s = _stats[agentWallet];
        s.totalEvents = old.totalEvents;
        s.lastEventTimestamp = old.lastEventTimestamp;
        s.proposalsApproved = old.proposalsApproved;
        _refreshLevel(agentWallet, s);

        emit LegacyClaimed(agentWallet, owner_, legacyKind, old.totalEvents);
        _safeMint(owner_, tokenId);
    }

    // ── Royalties & metadata ─────────────────────────────────────────────────

    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256) {
        return (creatorOf[tokenId], (salePrice * royaltyBps) / 10_000);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        address w = agentWalletOf(tokenId);
        AgentStats storage s = _stats[w];
        string memory name_ = bytes(agentName[w]).length > 0
            ? agentName[w]
            : string.concat("ASAJU Agent ", w.toHexString());
        string memory tier = s.wisdomUnlocked ? "wisdom" : s.currentLevel >= 5 ? "elite" : s.currentLevel >= 3 ? "advanced" : "standard";
        string memory image = bytes(imageBaseURI).length > 0
            ? string.concat('"image":"', imageBaseURI, tier, '.png",')
            : "";
        string memory attrs = string.concat(
            '[{"trait_type":"Niche","value":"', agentNiche[w],
            '"},{"trait_type":"Level","display_type":"number","value":', s.currentLevel.toString(),
            '},{"trait_type":"Lessons","display_type":"number","value":', s.totalEvents.toString(),
            '},{"trait_type":"Generation","display_type":"number","value":', s.generation.toString(),
            '},{"trait_type":"Wisdom","value":"', s.wisdomUnlocked ? "Unlocked" : "Locked",
            '"},{"trait_type":"Chain","value":"', chainLabel, '"}]'
        );
        string memory json = string.concat(
            '{"name":"', name_,
            '","description":"ASAJU autonomous agent passport. Agent wallet ', w.toHexString(), '.",',
            image,
            '"attributes":', attrs, "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getAgentStats(address agentWallet) external view returns (AgentStats memory) {
        return _stats[agentWallet];
    }

    function lessonCount(address agentWallet) external view returns (uint256) {
        return _lessons[agentWallet].length;
    }

    function lessonAt(address agentWallet, uint256 index) external view returns (bytes32) {
        return _lessons[agentWallet][index];
    }

    function decisionCount(address agentWallet) external view returns (uint256) {
        return _decisions[agentWallet].length;
    }

    function decisionAt(address agentWallet, uint256 id) external view returns (Decision memory) {
        return _decisions[agentWallet][id];
    }

    function getBreedRecord(bytes32 offspringId) external view returns (BreedRecord memory) {
        return breedRecords[offspringId];
    }

    /// @notice V6-compatible name; counts Passports (lessons are not tokens in V7).
    function getTotalMinted() external view returns (uint256) {
        return totalPassports;
    }

    function claimTypehash() external pure returns (bytes32) {
        return CLAIM_TYPEHASH;
    }

    function spawnConsentTypehash() external pure returns (bytes32) {
        return SPAWN_TYPEHASH;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId
            || interfaceId == bytes4(0x49064906) // ERC-4906
            || super.supportsInterface(interfaceId);
    }

    // ── Transfers ────────────────────────────────────────────────────────────

    /// @dev Transfers stay open while paused: owners can always move what they own.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        ownershipNonce[tokenId] += 1;
        emit AgentOwnershipTransferred(agentWalletOf(tokenId), from, to, block.timestamp);
    }

    // ── Admin (owner = TimelockController) ───────────────────────────────────

    function setFees(uint256 newSpawnFee, uint256 newProvision, uint256 newBreedCost) external onlyOwner {
        if (newProvision > newSpawnFee) revert ProvisionExceedsFee();
        spawnFee = newSpawnFee;
        agentProvision = newProvision;
        breedCost = newBreedCost;
        emit FeesUpdated(newSpawnFee, newProvision, newBreedCost);
    }

    function setBreedRules(uint64 cooldown, uint8 maxBreeds, uint256 minLevel) external onlyOwner {
        breedCooldown = cooldown;
        maxBreedsPerAgent = maxBreeds;
        minLevelToBreed = minLevel;
    }

    function setRoyaltyBps(uint16 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert ValueTooHigh();
        royaltyBps = bps;
        emit RoyaltyUpdated(bps);
    }

    function setImageBaseURI(string calldata uri) external onlyOwner {
        imageBaseURI = uri;
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    function setMinAgentBalanceForExecution(uint256 minBalance) external onlyOwner {
        minAgentBalanceForExecution = minBalance;
    }

    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function setMigrationSigner(address signer) external onlyOwner {
        if (migrationClosed) revert MigrationUnavailable();
        migrationSigner = signer;
        emit MigrationSignerUpdated(signer);
    }

    /// @notice Permanent. Guardian may close early; nobody can reopen.
    function closeMigration() external onlyGuardianOrOwner {
        migrationClosed = true;
        migrationSigner = address(0);
        emit MigrationClosed();
    }

    function pause() external onlyGuardianOrOwner { _pause(); }
    function unpause() external onlyGuardianOrOwner { _unpause(); }

    /// @notice Platform fees only; prepaid offspring provisions stay.
    function withdrawFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance <= pendingProvisionEscrow) revert NoFees();
        _sendValue(to, balance - pendingProvisionEscrow);
    }

    function _sendValue(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
