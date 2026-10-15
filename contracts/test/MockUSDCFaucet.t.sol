// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "../src/MockUSDC.sol";
import {MockUSDCFaucet} from "../src/MockUSDCFaucet.sol";
import {TestBase} from "./TestBase.sol";

contract MockUSDCFaucetTest is TestBase {
    MockUSDC private token;
    MockUSDCFaucet private faucet;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDC(address(this));
        faucet = new MockUSDCFaucet(token);
        token.transferOwnership(address(faucet));
    }

    function testFixedGrantAndPerAddressCooldown() public {
        vm.prank(OWNER);
        faucet.claim();
        require(token.balanceOf(OWNER) == 1_000e6, "Wrong faucet grant");
        vm.expectRevert(
            abi.encodeWithSelector(MockUSDCFaucet.CooldownActive.selector, block.timestamp + 1 days)
        );
        vm.prank(OWNER);
        faucet.claim();
        vm.prank(ATTACKER);
        faucet.claim();
        vm.warp(block.timestamp + 1 days);
        vm.prank(OWNER);
        faucet.claim();
        require(token.balanceOf(OWNER) == 2_000e6, "Second grant unavailable");
    }

    function testGlobalSupplyCapCannotBeBypassedByFreshAddress() public {
        MockUSDC almostFull = new MockUSDC(address(this));
        almostFull.mint(address(this), almostFull.MAX_SUPPLY() - 999e6);
        MockUSDCFaucet limited = new MockUSDCFaucet(almostFull);
        almostFull.transferOwnership(address(limited));
        vm.expectRevert(MockUSDC.SupplyCapExceeded.selector);
        vm.prank(OWNER);
        limited.claim();
        require(limited.nextClaimAt(OWNER) == 0, "Failed claim consumed cooldown");
    }

    function testDeployerCannotMintAfterFaucetOwnershipHandoff() public {
        (bool minted,) = address(token).call(abi.encodeCall(token.mint, (OWNER, 1)));
        require(!minted, "Deployer retained arbitrary mint authority");
    }
}
