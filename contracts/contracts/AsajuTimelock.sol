// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Admin of AsajuAgentV7 and AsajuMarketV7. Proposers/executors = the
///         multisig; no separate admin, so the timelock governs itself.
contract AsajuTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {}
}
