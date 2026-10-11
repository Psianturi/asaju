// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * AsajuMarketplaceERC20 — escrow sale of ASAJU agents paid in an ERC-20 token.
 *
 * Why this exists: the native-ETH AsajuMarketplace settles in the chain's gas
 * token, which is fine on BNB/ETH Sepolia but awkward where the project's own
 * token is the intended unit of account (VibeVibe testnet, ASA). This variant
 * takes the payment token as a constructor argument so the same escrow logic
 * can settle in ASA (or any IERC20 the deployer nominates) without touching
 * the agent contract.
 *
 * How it fits the agent contract: AsajuAgentV6 keeps the human owner in
 * agentOwner[agentWallet] and lets an *approved* marketplace move it via
 * transferAgentOwnership(). The agent owner approves this marketplace once
 * (setMarketplaceApproval(marketplace, true)); after that a sale settles
 * payment and ownership atomically in buy():
 *
 *   buyer pays price in ASA  ->  fee kept, remainder to seller, ownership moved.
 *
 * No platform key ever holds the agent. The agent's wallet, NFTs, level and
 * heritage are untouched — only the owner changes.
 *
 * Payment is pulled with transferFrom after an allowance grant, so the buyer
 * never hands the token to this contract directly. Combined with
 * ReentrancyGuard and checks-effects-interactions, that closes the usual
 * ERC-20 transfer pitfalls (missing return value, fee-on-transfer rebasing,
 * reentrancy through a malicious token).
 */
interface IAsajuAgent {
    function agentOwner(address agentWallet) external view returns (address);
    function transferAgentOwnership(address agentWallet, address newOwner) external;
}

contract AsajuMarketplaceERC20 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAsajuAgent public immutable agentContract;
    IERC20 public immutable paymentToken;

    uint256 public feeBps;                        // platform fee, basis points (1200 = 12%)
    uint256 public constant MAX_FEE_BPS = 2000;   // 20% hard cap, enforced on every set
    uint256 public accumulatedFees;               // withdrawable platform fees (token units)

    struct Listing {
        address seller;
        uint256 price;
        bool    active;
    }

    mapping(address => Listing) public listings;  // agentWallet => listing

    event AgentListed(address indexed agentWallet, address indexed seller, uint256 price);
    event ListingCancelled(address indexed agentWallet, address indexed seller);
    event AgentSold(
        address indexed agentWallet,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 fee
    );
    event FeeUpdated(uint256 feeBps);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error NotAgentOwner();
    error NotSeller();
    error NotListed();
    error AlreadyListed();
    error PriceZero();
    error InsufficientPayment();
    error FeeTooHigh();
    error InvalidAddress();

    constructor(address _agentContract, address _paymentToken, uint256 _feeBps) Ownable(msg.sender) {
        if (_agentContract == address(0)) revert InvalidAddress();
        if (_paymentToken == address(0)) revert InvalidAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        agentContract = IAsajuAgent(_agentContract);
        paymentToken = IERC20(_paymentToken);
        feeBps = _feeBps;
    }

    /// @dev List an agent for sale. Only the current on-chain owner may list.
    function list(address agentWallet, uint256 price) external {
        if (price == 0) revert PriceZero();
        if (agentContract.agentOwner(agentWallet) != msg.sender) revert NotAgentOwner();
        if (listings[agentWallet].active) revert AlreadyListed();
        listings[agentWallet] = Listing(msg.sender, price, true);
        emit AgentListed(agentWallet, msg.sender, price);
    }

    /// @dev Cancel a listing. Only the seller who created it may cancel.
    function cancel(address agentWallet) external {
        Listing memory l = listings[agentWallet];
        if (!l.active) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[agentWallet];
        emit ListingCancelled(agentWallet, msg.sender);
    }

    /// @dev Buy a listed agent with the payment token. Buyer must have approved
    ///      this contract to spend `price` units before calling.
    ///      Pays the seller (minus fee) and moves ownership atomically.
    ///      Overpayment is refunded in the same token.
    function buy(address agentWallet) external nonReentrant {
        Listing memory l = listings[agentWallet];
        if (!l.active) revert NotListed();

        // Guard a stale listing: the seller must still own the agent on-chain
        // (they may have transferred it off-market since listing). Reverting
        // returns the buyer's funds; the dead listing stays until the seller
        // cancels it (a revert would roll back any cleanup here anyway).
        if (agentContract.agentOwner(agentWallet) != l.seller) revert NotSeller();

        // Pull payment first so a bad allowance fails before we touch state.
        // SafeERC20 tolerates non-standard tokens that return nothing.
        paymentToken.safeTransferFrom(msg.sender, address(this), l.price);

        // Clear state before external calls (checks-effects-interactions).
        delete listings[agentWallet];

        uint256 fee = (l.price * feeBps) / 10000;
        uint256 toSeller = l.price - fee;
        accumulatedFees += fee;

        // Settle ownership — reverts if this marketplace isn't approved on the
        // agent contract, which also reverts the whole buy (funds stay with buyer).
        agentContract.transferAgentOwnership(agentWallet, msg.sender);

        if (toSeller > 0) paymentToken.safeTransfer(l.seller, toSeller);

        emit AgentSold(agentWallet, l.seller, msg.sender, l.price, fee);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 amt = accumulatedFees;
        accumulatedFees = 0;
        paymentToken.safeTransfer(to, amt);
        emit FeesWithdrawn(to, amt);
    }
}