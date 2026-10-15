// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BoundraExecutor} from "./BoundraExecutor.sol";
import {IBoundraVault} from "./interfaces/IBoundraVault.sol";

/// @notice Permissionless creation; every owner has one immutable, isolated executor.
contract BoundraFactory {
    address public immutable token;
    address public immutable liquidVault;
    address public immutable timedVault;
    mapping(address => address) public executorOf;

    error ExecutorAlreadyExists();
    error InvalidConfiguration();
    event ExecutorCreated(address indexed owner, address indexed executor);

    constructor(address asset, address liquid, address timed) {
        if (
            asset.code.length == 0 || liquid.code.length == 0 || timed.code.length == 0
                || liquid == timed
        ) revert InvalidConfiguration();
        if (
            IBoundraVault(liquid).asset() != asset || IBoundraVault(timed).asset() != asset
                || IBoundraVault(liquid).lockupSeconds() != 0
                || IBoundraVault(timed).lockupSeconds() != 30 days
        ) revert InvalidConfiguration();
        token = asset;
        liquidVault = liquid;
        timedVault = timed;
    }

    function createExecutor() external returns (address executor) {
        if (executorOf[msg.sender] != address(0)) revert ExecutorAlreadyExists();
        executor = address(new BoundraExecutor(msg.sender, token, liquidVault, timedVault));
        executorOf[msg.sender] = executor;
        emit ExecutorCreated(msg.sender, executor);
    }
}
