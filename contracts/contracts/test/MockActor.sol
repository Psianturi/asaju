// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test-only contract account: runs arbitrary calls, refuses plain coin
///      transfers, and can re-enter a target when it receives an ERC-721.
contract MockActor {
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterSucceeded;

    function exec(address to, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call{value: msg.value}(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        return ret;
    }

    function setReentry(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (reenterTarget != address(0)) {
            (bool ok, ) = reenterTarget.call(reenterData);
            reenterSucceeded = ok;
        }
        return this.onERC721Received.selector;
    }

    receive() external payable {
        revert("MockActor refuses coin");
    }
}
