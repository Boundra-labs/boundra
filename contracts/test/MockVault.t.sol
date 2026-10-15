// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "../src/MockUSDC.sol";
import {MockVault} from "../src/MockVault.sol";
import {LiquidVault} from "../src/LiquidVault.sol";
import {TimedVault} from "../src/TimedVault.sol";
import {IBoundraVault} from "../src/interfaces/IBoundraVault.sol";
import {TestBase} from "./TestBase.sol";

contract MockVaultTest is TestBase {
    MockUSDC private token;
    LiquidVault private liquid;
    TimedVault private timed;
    uint256 private constant AMOUNT = 300e6;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDC(address(this));
        liquid = new LiquidVault(address(token), address(this));
        timed = new TimedVault(address(token), address(this));
        token.mint(OWNER, AMOUNT * 2);
        vm.startPrank(OWNER);
        token.approve(address(liquid), AMOUNT * 2);
        token.approve(address(timed), AMOUNT * 2);
        vm.stopPrank();
    }

    function testLiquidRoundTripPreservesPrincipalWithoutYield() public {
        vm.startPrank(OWNER);
        liquid.deposit(AMOUNT);
        require(liquid.principal(OWNER) == AMOUNT, "Wrong principal");
        require(liquid.maxWithdraw(OWNER) == AMOUNT, "Liquid position unavailable");
        liquid.withdraw(AMOUNT);
        vm.stopPrank();
        require(token.balanceOf(OWNER) == AMOUNT * 2, "Unexpected yield or loss");
        require(liquid.totalPrincipal() == 0, "Principal not cleared");
    }

    function testTimedPositionCannotExitBeforeUnlock() public {
        vm.prank(OWNER);
        timed.deposit(AMOUNT);
        uint256 until = block.timestamp + 30 days;
        require(timed.maxWithdraw(OWNER) == 0, "Early liquidity reported");
        vm.expectRevert(abi.encodeWithSelector(MockVault.PositionLocked.selector, until));
        vm.prank(OWNER);
        timed.withdraw(AMOUNT);
        vm.warp(until);
        vm.prank(OWNER);
        timed.withdraw(AMOUNT);
        require(timed.principal(OWNER) == 0, "Position not cleared");
    }

    function testTopUpExtendsUnlockForWholePosition() public {
        vm.prank(OWNER);
        timed.deposit(AMOUNT);
        vm.warp(block.timestamp + 1 days);
        vm.prank(OWNER);
        timed.deposit(AMOUNT);
        require(timed.unlockAt(OWNER) == block.timestamp + 30 days, "Unlock not extended");
        require(timed.principal(OWNER) == AMOUNT * 2, "Top-up missing");
    }

    function testDegradedBlocksDepositButPermitsCapacityBoundedExit() public {
        vm.prank(OWNER);
        liquid.deposit(AMOUNT);
        liquid.setRiskState(IBoundraVault.RiskLevel.DEGRADED, 100e6);
        vm.expectRevert(MockVault.DepositsDisabled.selector);
        vm.prank(OWNER);
        liquid.deposit(1);
        vm.expectRevert(MockVault.InsufficientCapacity.selector);
        vm.prank(OWNER);
        liquid.withdraw(100e6 + 1);
        vm.prank(OWNER);
        liquid.withdraw(100e6);
        require(liquid.maxWithdraw(OWNER) == 0, "Capacity not consumed");
        require(liquid.principal(OWNER) == 200e6, "Remaining position wrong");
        liquid.setRiskState(IBoundraVault.RiskLevel.DEGRADED, 200e6);
        vm.prank(OWNER);
        liquid.withdraw(200e6);
    }

    function testAnotherAccountCannotWithdrawOwnersPrincipalOrChangeRisk() public {
        vm.prank(OWNER);
        liquid.deposit(AMOUNT);
        vm.expectRevert(MockVault.InsufficientPrincipal.selector);
        vm.prank(ATTACKER);
        liquid.withdraw(1);
        vm.prank(ATTACKER);
        (bool changed,) = address(liquid)
            .call(abi.encodeCall(liquid.setRiskState, (IBoundraVault.RiskLevel.DEGRADED, 0)));
        require(!changed, "Risk admin bypass");
        require(liquid.principal(OWNER) == AMOUNT, "Owner position changed");
    }

    function testZeroDepositAndWithdrawalRejected() public {
        vm.expectRevert(MockVault.InvalidAmount.selector);
        liquid.deposit(0);
        vm.expectRevert(MockVault.InvalidAmount.selector);
        liquid.withdraw(0);
    }

    function testFuzzPartialExitPreservesBacking(uint96 raw) public {
        uint256 amount = uint256(raw) % AMOUNT + 1;
        vm.startPrank(OWNER);
        liquid.deposit(AMOUNT);
        liquid.withdraw(amount);
        vm.stopPrank();
        require(token.balanceOf(address(liquid)) == liquid.totalPrincipal(), "Backing mismatch");
        require(liquid.principal(OWNER) + amount == AMOUNT, "Accounting mismatch");
    }
}
