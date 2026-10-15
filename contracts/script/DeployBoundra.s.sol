// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "../src/MockUSDC.sol";
import {MockUSDCFaucet} from "../src/MockUSDCFaucet.sol";
import {LiquidVault} from "../src/LiquidVault.sol";
import {TimedVault} from "../src/TimedVault.sol";
import {BoundraFactory} from "../src/BoundraFactory.sol";

interface DeployVm {
    function envUint(string calldata name) external returns (uint256);
    function addr(uint256 key) external returns (address);
    function startBroadcast(uint256 key) external;
    function stopBroadcast() external;
}

/// @notice Requires explicitly provisioned runtime key; supports testnet/local chains only.
contract DeployBoundra {
    DeployVm private constant vm =
        DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event Deployment(address token, address faucet, address liquid, address timed, address factory);

    function run(address riskAdmin) external returns (address, address, address, address, address) {
        require(
            block.chainid == 84532 || block.chainid == 31337,
            "Only Base Sepolia or local development"
        );
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        require(riskAdmin != address(0) && riskAdmin != deployer, "Separate risk admin required");
        vm.startBroadcast(key);
        MockUSDC token = new MockUSDC(deployer);
        MockUSDCFaucet faucet = new MockUSDCFaucet(token);
        token.transferOwnership(address(faucet));
        LiquidVault liquid = new LiquidVault(address(token), riskAdmin);
        TimedVault timed = new TimedVault(address(token), riskAdmin);
        BoundraFactory factory = new BoundraFactory(address(token), address(liquid), address(timed));
        vm.stopBroadcast();
        emit Deployment(
            address(token), address(faucet), address(liquid), address(timed), address(factory)
        );
        return (address(token), address(faucet), address(liquid), address(timed), address(factory));
    }
}
