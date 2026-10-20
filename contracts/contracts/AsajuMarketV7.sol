// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAsajuPassport is IERC721 {
    function creatorOf(uint256 tokenId) external view returns (address);
    function royaltyBps() external view returns (uint16);
    function ownershipNonce(uint256 tokenId) external view returns (uint256);
}

/**
 * @title ASAJU Market V7
 * @notice Non-custodial sale of Agent Passports. The seller keeps the token and
 *         approves this contract; a sale needs a live listing by the current
 *         owner and full payment. Fee and royalty are fixed when listing.
 *         Proceeds are credited and withdrawn (pull payments).
 *         paymentToken == address(0) means the native coin.
 */
contract AsajuMarketV7 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 1000;              // 10%
    uint64 public constant MAX_LISTING_DURATION = 180 days;

    IAsajuPassport public immutable passport;
    IERC20 public immutable paymentToken;

    address public treasury;
    address public guardian;
    uint16  public feeBps;

    struct Listing {
        address seller;
        uint64  expiresAt;
        uint16  feeBps;
        uint16  royaltyBps;
        uint128 price;
        uint256 nonce;      // passport ownershipNonce when listed
    }

    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public credits;
    uint256 public totalCredits;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiresAt, uint16 feeBps, uint16 royaltyBps);
    event Cancelled(uint256 indexed tokenId, address indexed by);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee, uint256 royalty);
    event Withdrawn(address indexed account, uint256 amount);
    event FeeUpdated(uint16 feeBps);
    event TreasuryUpdated(address treasury);
    event GuardianUpdated(address guardian);

    error InvalidAddress();
    error NotOwner();
    error NotApproved();
    error PriceZero();
    error BadExpiry();
    error NotListed();
    error ListingExpired();
    error ListingStale();
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error WrongPayment(uint256 expected, uint256 sent);
    error FeeTooHigh();
    error NothingToWithdraw();
    error NotAuthorized();
    error TransferFailed();

    constructor(address passport_, address paymentToken_, address admin, address guardian_, address treasury_, uint16 feeBps_)
        Ownable(admin)
    {
        if (passport_ == address(0) || treasury_ == address(0)) revert InvalidAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        passport = IAsajuPassport(passport_);
        paymentToken = IERC20(paymentToken_);
        guardian = guardian_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ── Listing ──────────────────────────────────────────────────────────────

    /// @notice Lists (or re-prices) a Passport. Overwrites any older listing,
    ///         so a listing left by a previous owner never blocks this one.
    function list(uint256 tokenId, uint128 price, uint64 expiresAt) external whenNotPaused {
        address owner_ = passport.ownerOf(tokenId);
        if (owner_ != msg.sender) revert NotOwner();
        if (price == 0) revert PriceZero();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_LISTING_DURATION) revert BadExpiry();
        if (passport.getApproved(tokenId) != address(this) && !passport.isApprovedForAll(owner_, address(this))) revert NotApproved();

        uint16 royalty = passport.royaltyBps();
        listings[tokenId] = Listing(msg.sender, expiresAt, feeBps, royalty, price, passport.ownershipNonce(tokenId));
        emit Listed(tokenId, msg.sender, price, expiresAt, feeBps, royalty);
    }

    /// @notice The seller, or whoever owns the Passport now, may cancel.
    function cancel(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender != l.seller && msg.sender != passport.ownerOf(tokenId)) revert NotAuthorized();
        delete listings[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    /// @notice True when buy() would find a valid listing (payment aside).
    function isListingValid(uint256 tokenId) public view returns (bool) {
        Listing memory l = listings[tokenId];
        return l.seller != address(0)
            && block.timestamp < l.expiresAt
            && passport.ownerOf(tokenId) == l.seller
            && passport.ownershipNonce(tokenId) == l.nonce
            && (passport.getApproved(tokenId) == address(this) || passport.isApprovedForAll(l.seller, address(this)));
    }

    // ── Buying ───────────────────────────────────────────────────────────────

    /// @param maxPrice  The most the buyer agreed to pay; guards against re-pricing.
    function buy(uint256 tokenId, uint128 maxPrice) external payable whenNotPaused nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (block.timestamp >= l.expiresAt) revert ListingExpired();
        if (passport.ownerOf(tokenId) != l.seller || passport.ownershipNonce(tokenId) != l.nonce) revert ListingStale();
        if (l.price > maxPrice) revert PriceAboveMax(l.price, maxPrice);

        delete listings[tokenId];

        if (address(paymentToken) == address(0)) {
            if (msg.value != l.price) revert WrongPayment(l.price, msg.value);
        } else {
            if (msg.value != 0) revert WrongPayment(0, msg.value);
            uint256 before = paymentToken.balanceOf(address(this));
            paymentToken.safeTransferFrom(msg.sender, address(this), l.price);
            uint256 received = paymentToken.balanceOf(address(this)) - before;
            if (received != l.price) revert WrongPayment(l.price, received);
        }

        uint256 fee = (uint256(l.price) * l.feeBps) / 10_000;
        uint256 royalty = (uint256(l.price) * l.royaltyBps) / 10_000;
        address creator = passport.creatorOf(tokenId);
        if (creator == address(0)) {
            royalty = 0;
        }
        _credit(treasury, fee);
        _credit(creator, royalty);
        _credit(l.seller, uint256(l.price) - fee - royalty);

        passport.safeTransferFrom(l.seller, msg.sender, tokenId);
        emit Sold(tokenId, l.seller, msg.sender, l.price, fee, royalty);
    }

    function _credit(address account, uint256 amount) private {
        if (amount == 0) return;
        credits[account] += amount;
        totalCredits += amount;
    }

    /// @notice Pull your proceeds. Works while paused.
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        totalCredits -= amount;
        if (address(paymentToken) == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            paymentToken.safeTransfer(msg.sender, amount);
        }
        emit Withdrawn(msg.sender, amount);
    }

    // ── Admin (owner = TimelockController) ───────────────────────────────────

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotAuthorized();
        _pause();
    }

    function unpause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotAuthorized();
        _unpause();
    }
}
