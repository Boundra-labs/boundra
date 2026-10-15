// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BoundraExecutor} from "../src/BoundraExecutor.sol";
import {BoundraFactory} from "../src/BoundraFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {LiquidVault} from "../src/LiquidVault.sol";
import {TimedVault} from "../src/TimedVault.sol";
import {TestBase} from "./TestBase.sol";

contract BoundraExecutorTest is TestBase {
    MockUSDC internal token;
    LiquidVault internal liquid;
    TimedVault internal timed;
    BoundraFactory internal factory;
    BoundraExecutor internal executor;
    uint256 internal constant AMOUNT = 300e6;

    function setUp() public virtual {
        vm.warp(1_000_000);
        token = new MockUSDC(address(this));
        liquid = new LiquidVault(address(token), address(this));
        timed = new TimedVault(address(token), address(this));
        factory = new BoundraFactory(address(token), address(liquid), address(timed));
        vm.prank(OWNER);
        executor = BoundraExecutor(factory.createExecutor());
        token.mint(OWNER, AMOUNT);
        vm.startPrank(OWNER);
        token.approve(address(executor), AMOUNT);
        executor.fund(AMOUNT);
        executor.setMandate(defaultMandate());
        vm.stopPrank();
    }

    function defaultMandate() internal view returns (BoundraExecutor.Mandate memory) {
        return BoundraExecutor.Mandate({
            chainId: block.chainid,
            asset: address(token),
            operator: OPERATOR,
            beneficiary: OWNER,
            expiresAt: uint64(block.timestamp + 7 days),
            allowedVaults: 1,
            allowedActions: 3,
            maxLockupSeconds: 0,
            maxDepositPerAction: AMOUNT,
            maxCumulativeDeposits: AMOUNT,
            maxWithdrawPerAction: AMOUNT,
            allocationTarget: AMOUNT
        });
    }

    function deposit(uint256 amount) internal {
        vm.prank(OPERATOR);
        executor.executeDeposit(
            keccak256("deposit"), 1, 0, uint64(block.timestamp + 1 hours), address(liquid), amount
        );
    }

    function testDepositAndWithdrawPaysOnlyOwnerAndClearsAllowance() public {
        deposit(AMOUNT);
        require(liquid.principal(address(executor)) == AMOUNT, "Missing position");
        require(token.allowance(address(executor), address(liquid)) == 0, "Residual approval");
        vm.prank(OPERATOR);
        executor.executeWithdraw(
            keccak256("exit"), 1, 1, uint64(block.timestamp + 1 hours), address(liquid), AMOUNT
        );
        require(token.balanceOf(OWNER) == AMOUNT, "Owner not paid");
        require(token.balanceOf(OPERATOR) == 0, "Operator received funds");
        require(executor.cumulativeDeposited() == AMOUNT, "Budget refilled");
    }

    function testOnlyOwnerChangesAuthority() public {
        BoundraExecutor.Mandate memory next = defaultMandate();
        vm.expectRevert(BoundraExecutor.OwnerOnly.selector);
        vm.prank(OPERATOR);
        executor.setMandate(next);
        vm.expectRevert(BoundraExecutor.OwnerOnly.selector);
        vm.prank(OPERATOR);
        executor.revoke();
        vm.expectRevert(BoundraExecutor.OwnerOnly.selector);
        vm.prank(ATTACKER);
        executor.recoverIdle(AMOUNT);
    }

    function testPausedOperatorBlockedOwnerRecoveryAvailable() public {
        deposit(AMOUNT);
        vm.prank(OWNER);
        executor.pause();
        vm.expectRevert(BoundraExecutor.InactiveMandate.selector);
        vm.prank(OPERATOR);
        executor.executeWithdraw(
            keccak256("exit"), 1, 1, uint64(block.timestamp + 1 hours), address(liquid), AMOUNT
        );
        vm.prank(OWNER);
        executor.ownerWithdraw(address(liquid), AMOUNT);
        require(token.balanceOf(OWNER) == AMOUNT, "Recovery unavailable");
    }

    function testRejectedCallDoesNotConsumeNonceOrActionId() public {
        vm.expectRevert(BoundraExecutor.DepositLimit.selector);
        deposit(AMOUNT + 1);
        require(executor.nextActionNonce() == 0, "Failed call consumed nonce");
        require(!executor.consumedActionIds(keccak256("deposit")), "Failed call consumed ID");
        deposit(AMOUNT);
    }

    function testReplayAndRepeatedAllocationRejected() public {
        deposit(AMOUNT);
        vm.expectRevert(BoundraExecutor.Replay.selector);
        deposit(1);
        vm.expectRevert(BoundraExecutor.BudgetExceeded.selector);
        vm.prank(OPERATOR);
        executor.executeDeposit(
            keccak256("another"), 1, 1, uint64(block.timestamp + 1 hours), address(liquid), 1
        );
    }

    function testCannotReplaceMandateWithOpenPosition() public {
        deposit(AMOUNT);
        BoundraExecutor.Mandate memory next = defaultMandate();
        vm.expectRevert(BoundraExecutor.OpenPosition.selector);
        vm.prank(OWNER);
        executor.setMandate(next);
    }

    function testFactoryIsolatesOwnersAndRejectsDuplicate() public {
        vm.prank(ATTACKER);
        BoundraExecutor other = BoundraExecutor(factory.createExecutor());
        require(other.owner() == ATTACKER && other.token() == address(token), "Incorrect owner");
        require(token.balanceOf(address(other)) == 0, "Funds pooled");
        vm.expectRevert(BoundraFactory.ExecutorAlreadyExists.selector);
        vm.prank(OWNER);
        factory.createExecutor();
    }
}
