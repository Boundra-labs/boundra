// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "./MockUSDC.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Testnet-only fixed grant; token ownership must be transferred here after deployment.
contract MockUSDCFaucet is ReentrancyGuard {
    MockUSDC public immutable token;
    uint256 public constant CLAIM_AMOUNT = 1_000e6;
    uint256 public constant COOLDOWN = 1 days;
    mapping(address => uint256) public nextClaimAt;

    error CooldownActive(uint256 until);
    event Claimed(address indexed recipient, uint256 amount, uint256 nextClaimTimestamp);

    constructor(MockUSDC asset) {
        token = asset;
    }

    function claim() external nonReentrant {
        if (block.timestamp < nextClaimAt[msg.sender]) {
            revert CooldownActive(nextClaimAt[msg.sender]);
        }
        nextClaimAt[msg.sender] = block.timestamp + COOLDOWN;
        // MockUSDC enforces the fixed global supply cap. A failed mint rolls back cooldown.
        token.mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT, nextClaimAt[msg.sender]);
    }
}
