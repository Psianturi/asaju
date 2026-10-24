// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only mintable ERC-20 standing in for ASA in verify-marketplace-erc20.js.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock ASA", "mASA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
