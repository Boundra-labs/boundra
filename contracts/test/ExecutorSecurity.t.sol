// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BoundraExecutor} from "../src/BoundraExecutor.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {LiquidVault} from "../src/LiquidVault.sol";
import {TimedVault} from "../src/TimedVault.sol";
import {MockVault} from "../src/MockVault.sol";
import {IBoundraVault} from "../src/interfaces/IBoundraVault.sol";
import {TestBase} from "./TestBase.sol";

abstract contract ExecutorSecurityFixture is TestBase {
    MockUSDC internal token;
    LiquidVault internal liquid;
    TimedVault internal timed;
    BoundraExecutor internal executor;
    uint256 internal constant AMOUNT = 300e6;

    function setUp() public virtual {
        vm.warp(1_000_000);
        token = new MockUSDC(address(this));
        liquid = new LiquidVault(address(token), address(this));
        timed = new TimedVault(address(token), address(this));
        executor = new BoundraExecutor(OWNER, address(token), address(liquid), address(timed));
        token.mint(OWNER, AMOUNT);
        vm.startPrank(OWNER);
        token.approve(address(executor), AMOUNT);
        executor.fund(AMOUNT);
        executor.setMandate(policy());
        vm.stopPrank();
    }

    function policy() internal view returns (BoundraExecutor.Mandate memory) {
        return BoundraExecutor.Mandate(
            block.chainid,
            address(token),
            OPERATOR,
            OWNER,
            uint64(block.timestamp + 40 days),
            3,
            3,
            uint32(30 days),
            AMOUNT,
            AMOUNT,
            AMOUNT,
            AMOUNT
        );
    }

    function runDeposit(
        address target,
        uint256 amount,
        bytes32 id,
        uint256 version,
        uint256 nonce,
        uint64 deadline
    ) internal {
        vm.prank(OPERATOR);
        executor.executeDeposit(id, version, nonce, deadline, target, amount);
    }

    function goodDeposit() internal {
        runDeposit(
            address(liquid), AMOUNT, keccak256("deposit"), 1, 0, uint64(block.timestamp + 1 hours)
        );
    }
}

contract ExecutorSecurityTest is ExecutorSecurityFixture {
    function testWrongTargetVersionNonceDeadlineAndChainAreDenied() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 id = keccak256("invalid");
        vm.expectRevert(BoundraExecutor.TargetNotAllowed.selector);
        runDeposit(ATTACKER, 1, id, 1, 0, deadline);
        vm.expectRevert(BoundraExecutor.WrongVersion.selector);
        runDeposit(address(liquid), 1, id, 2, 0, deadline);
        vm.expectRevert(BoundraExecutor.WrongNonce.selector);
        runDeposit(address(liquid), 1, id, 1, 1, deadline);
        vm.expectRevert(BoundraExecutor.InvalidDeadline.selector);
        runDeposit(address(liquid), 1, id, 1, 0, uint64(block.timestamp));
        vm.expectRevert(BoundraExecutor.InvalidDeadline.selector);
        runDeposit(address(liquid), 1, id, 1, 0, uint64(block.timestamp + 41 days));
        vm.chainId(block.chainid + 1);
        vm.expectRevert(BoundraExecutor.WrongChain.selector);
        runDeposit(address(liquid), 1, id, 1, 0, deadline);
    }

    function testCannotAuthorizeWrongTokenBeneficiaryOrChain() public {
        BoundraExecutor.Mandate memory next = policy();
        next.asset = ATTACKER;
        vm.expectRevert(BoundraExecutor.InvalidMandate.selector);
        vm.prank(OWNER);
        executor.setMandate(next);
        next = policy();
        next.beneficiary = ATTACKER;
        vm.expectRevert(BoundraExecutor.InvalidMandate.selector);
        vm.prank(OWNER);
        executor.setMandate(next);
        next = policy();
        next.chainId++;
        vm.expectRevert(BoundraExecutor.WrongChain.selector);
        vm.prank(OWNER);
        executor.setMandate(next);
    }

    function testTimedDepositChecksLockupAndExpiryAtExecution() public {
        BoundraExecutor.Mandate memory next = policy();
        next.maxLockupSeconds = 0;
        vm.prank(OWNER);
        executor.setMandate(next);
        vm.expectRevert(BoundraExecutor.LockupNotAllowed.selector);
        runDeposit(
            address(timed), AMOUNT, keccak256("timed"), 2, 0, uint64(block.timestamp + 1 hours)
        );
        next = policy();
        next.expiresAt = uint64(block.timestamp + 7 days);
        vm.prank(OWNER);
        executor.setMandate(next);
        vm.expectRevert(BoundraExecutor.ExpiryBeforeUnlock.selector);
        runDeposit(
            address(timed), AMOUNT, keccak256("timed"), 3, 0, uint64(block.timestamp + 1 hours)
        );
        next = policy();
        vm.prank(OWNER);
        executor.setMandate(next);
        runDeposit(
            address(timed), AMOUNT, keccak256("timed"), 4, 0, uint64(block.timestamp + 1 hours)
        );
        vm.prank(OWNER);
        executor.revoke();
        vm.expectRevert(
            abi.encodeWithSelector(
                MockVault.PositionLocked.selector, timed.unlockAt(address(executor))
            )
        );
        vm.prank(OWNER);
        executor.ownerWithdraw(address(timed), AMOUNT);
        vm.warp(block.timestamp + 30 days);
        vm.prank(OWNER);
        executor.ownerWithdraw(address(timed), AMOUNT);
        require(token.balanceOf(OWNER) == AMOUNT, "Matured recovery failed");
    }

    function testRiskWarningAndActionAndTargetMasksAreHardConstraints() public {
        liquid.setRiskState(IBoundraVault.RiskLevel.DEGRADED, AMOUNT);
        vm.expectRevert(BoundraExecutor.VaultDegraded.selector);
        goodDeposit();
        liquid.setRiskState(IBoundraVault.RiskLevel.NORMAL, type(uint256).max);
        BoundraExecutor.Mandate memory next = policy();
        next.allowedActions = 2;
        vm.prank(OWNER);
        executor.setMandate(next);
        vm.expectRevert(BoundraExecutor.ActionNotAllowed.selector);
        runDeposit(address(liquid), 1, keccak256("action"), 2, 0, uint64(block.timestamp + 1 hours));
        next.allowedActions = 3;
        next.allowedVaults = 2;
        vm.prank(OWNER);
        executor.setMandate(next);
        vm.expectRevert(BoundraExecutor.TargetNotAllowed.selector);
        runDeposit(address(liquid), 1, keccak256("target"), 3, 0, uint64(block.timestamp + 1 hours));
    }

    function testRevocationCannotBeResumedAndExpiryBlocksOperator() public {
        vm.prank(OWNER);
        executor.revoke();
        vm.expectRevert(BoundraExecutor.InactiveMandate.selector);
        goodDeposit();
        vm.expectRevert(BoundraExecutor.InactiveMandate.selector);
        vm.prank(OWNER);
        executor.resume();
        vm.prank(OWNER);
        executor.setMandate(policy());
        vm.warp(block.timestamp + 40 days);
        vm.expectRevert(BoundraExecutor.InactiveMandate.selector);
        runDeposit(address(liquid), 1, keccak256("expired"), 2, 0, uint64(block.timestamp + 1));
        vm.prank(OWNER);
        executor.recoverIdle(AMOUNT);
    }

    function testPartialExitAndNewAuthorizationCannotReplayOldAction() public {
        BoundraExecutor.Mandate memory next = policy();
        next.maxWithdrawPerAction = 100e6;
        vm.prank(OWNER);
        executor.setMandate(next);
        runDeposit(
            address(liquid), AMOUNT, keccak256("deposit"), 2, 0, uint64(block.timestamp + 1 hours)
        );
        vm.expectRevert(BoundraExecutor.WithdrawalLimit.selector);
        vm.prank(OPERATOR);
        executor.executeWithdraw(
            keccak256("excess"), 2, 1, uint64(block.timestamp + 1 hours), address(liquid), AMOUNT
        );
        for (uint256 i = 1; i <= 3; i++) {
            vm.prank(OPERATOR);
            executor.executeWithdraw(
                bytes32(i), 2, i, uint64(block.timestamp + 1 hours), address(liquid), 100e6
            );
        }
        require(executor.cumulativeDeposited() == AMOUNT, "Withdrawal refilled budget");
        require(liquid.principal(address(executor)) == 0, "Partial exit incomplete");
        vm.prank(OWNER);
        executor.setMandate(policy());
        vm.expectRevert(BoundraExecutor.Replay.selector);
        runDeposit(
            address(liquid), 1, keccak256("deposit"), 3, 4, uint64(block.timestamp + 1 hours)
        );
        vm.expectRevert(BoundraExecutor.WrongNonce.selector);
        runDeposit(address(liquid), 1, keccak256("fresh"), 3, 0, uint64(block.timestamp + 1 hours));
    }

    function testPartialAllocationCannotTopUpEvenWithRemainingBudget() public {
        runDeposit(
            address(liquid), 100e6, keccak256("partial"), 1, 0, uint64(block.timestamp + 1 hours)
        );
        vm.expectRevert(BoundraExecutor.AllocationAlreadyCompleted.selector);
        runDeposit(
            address(liquid), 100e6, keccak256("topup"), 1, 1, uint64(block.timestamp + 1 hours)
        );
    }

    function testNoArbitraryCallOrUnauthorizedWithdrawal() public {
        vm.prank(ATTACKER);
        (bool sent,) = address(executor)
            .call(
                abi.encodeWithSignature(
                    "execute(address,bytes)",
                    address(token),
                    abi.encodeCall(token.transfer, (ATTACKER, AMOUNT))
                )
            );
        require(!sent, "Arbitrary call enabled");
        vm.expectRevert(BoundraExecutor.OperatorOnly.selector);
        vm.prank(ATTACKER);
        executor.executeWithdraw(
            bytes32(uint256(1)), 1, 0, uint64(block.timestamp + 1 hours), address(liquid), 1
        );
    }
}

contract ExecutorInvariantHandler is TestBase {
    BoundraExecutor public immutable executor;
    LiquidVault public immutable liquid;
    uint256 public successes;

    constructor(BoundraExecutor account, LiquidVault target) {
        executor = account;
        liquid = target;
    }

    function tryDeposit(uint96 raw) external {
        uint256 nonce = executor.nextActionNonce();
        vm.prank(OPERATOR);
        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    executor.executeDeposit,
                    (
                        keccak256(abi.encode("deposit", nonce)),
                        1,
                        nonce,
                        uint64(block.timestamp + 60),
                        address(liquid),
                        uint256(raw) % 400e6 + 1
                    )
                )
            );
        if (ok) successes++;
    }

    function tryWithdraw(uint96 raw) external {
        uint256 nonce = executor.nextActionNonce();
        vm.prank(OPERATOR);
        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    executor.executeWithdraw,
                    (
                        keccak256(abi.encode("exit", nonce)),
                        1,
                        nonce,
                        uint64(block.timestamp + 60),
                        address(liquid),
                        uint256(raw) % 400e6 + 1
                    )
                )
            );
        if (!ok) return;
    }

    function ownerPauseOrResume(bool pauseNow) external {
        vm.prank(OWNER);
        if (pauseNow) executor.pause();
        else executor.resume();
    }

    function tryRecoverIdle(uint96 raw) external {
        vm.prank(OWNER);
        (bool ok,) =
            address(executor).call(abi.encodeCall(executor.recoverIdle, (uint256(raw) % 400e6 + 1)));
        if (!ok) return;
    }
}

contract ExecutorInvariantTest is ExecutorSecurityFixture {
    ExecutorInvariantHandler private handler;

    function setUp() public override {
        super.setUp();
        handler = new ExecutorInvariantHandler(executor, liquid);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariantBudgetAndSingleAllocation() public view {
        require(executor.cumulativeDeposited() <= AMOUNT, "Budget exceeded");
        require(handler.successes() <= 1, "Repeated allocation");
    }

    function invariantConservationAndBeneficiary() public view {
        require(
            token.balanceOf(OWNER) + token.balanceOf(address(executor))
                    + liquid.principal(address(executor)) == AMOUNT,
            "Principal not conserved"
        );
        require(
            token.balanceOf(OPERATOR) == 0 && token.balanceOf(ATTACKER) == 0,
            "Unauthorized beneficiary"
        );
        require(
            token.balanceOf(address(liquid)) == liquid.totalPrincipal(), "Vault backing mismatch"
        );
        require(
            token.allowance(address(executor), address(liquid)) == 0, "Residual spender approval"
        );
    }
}
