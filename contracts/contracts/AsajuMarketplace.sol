// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * AsajuMarketplace — trustless escrow sale of ASAJU agents (Fase 2).
 *
 * How it fits the agent contract: AsajuAgentV6 keeps the human owner in
 * agentOwner[agentWallet] and lets an *approved* marketplace move it via
 * transferAgentOwnership(). The agent contract owner must approve this
 * marketplace once (setMarketplaceApproval(marketplace, true)); after that a
 * sale settles payment and ownership atomically in buy():
 *
 *   buyer pays price  ->  fee kept, remainder paid to seller, ownership moved.
 *
 * No platform key ever holds the agent; the contract only moves it the instant
 * payment clears. The agent's wallet, NFTs, level and heritage are untouched —
 * only the owner changes.
 */
interface IAsajuAgent {
    function agentOwner(address agentWallet) external view returns (address);
    function transferAgentOwnership(address agentWallet, address newOwner) external;
}

contract AsajuMarketplace is Ownable, ReentrancyGuard {
    IAsajuAgent public immutable agentContract;

    uint256 public feeBps;                        // platform fee, basis points (1200 = 12%)
    uint256 public constant MAX_FEE_BPS = 2000;   // 20% hard cap, enforced on every set
    uint256 public accumulatedFees;               // withdrawable platform fees (wei)

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

    error NotAgentOwner();
    error NotSeller();
    error NotListed();
    error AlreadyListed();
    error PriceZero();
    error InsufficientPayment();
    error FeeTooHigh();
    error InvalidAddress();

    constructor(address _agentContract, uint256 _feeBps) Ownable(msg.sender) {
        if (_agentContract == address(0)) revert InvalidAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        agentContract = IAsajuAgent(_agentContract);
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

    /// @dev Buy a listed agent. Pays the seller (minus fee) and moves ownership
    ///      atomically. Overpayment is refunded.
    function buy(address agentWallet) external payable nonReentrant {
        Listing memory l = listings[agentWallet];
        if (!l.active) revert NotListed();
        if (msg.value < l.price) revert InsufficientPayment();

        // Guard a stale listing: the seller must still own the agent on-chain
        // (they may have transferred it off-market since listing). Reverting
        // returns the buyer's funds; the dead listing stays until the seller
        // cancels it (a revert would roll back any cleanup here anyway).
        if (agentContract.agentOwner(agentWallet) != l.seller) revert NotSeller();

        // Clear state before external calls (checks-effects-interactions).
        delete listings[agentWallet];

        uint256 fee = (l.price * feeBps) / 10000;
        uint256 toSeller = l.price - fee;
        accumulatedFees += fee;

        // Settle ownership — reverts if this marketplace isn't approved on the
        // agent contract, which also reverts the whole buy (funds stay with buyer).
        agentContract.transferAgentOwnership(agentWallet, msg.sender);

        (bool sellerOk, ) = payable(l.seller).call{value: toSeller}("");
        require(sellerOk, "Seller payout failed");

        if (msg.value > l.price) {
            (bool refundOk, ) = payable(msg.sender).call{value: msg.value - l.price}("");
            require(refundOk, "Refund failed");
        }

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
        (bool ok, ) = payable(to).call{value: amt}("");
        require(ok, "Withdraw failed");
    }
}
