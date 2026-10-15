// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBoundraVault} from "./interfaces/IBoundraVault.sol";

/// @notice Non-upgradeable owner account with typed, bounded operator permissions.
contract BoundraExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant DEPOSIT = 1;
    uint8 public constant WITHDRAW = 2;
    uint256 public constant EXIT_BUFFER = 1 days;
    address public immutable owner;
    address public immutable token;
    address public immutable liquidVault;
    address public immutable timedVault;
    uint256 public immutable deploymentChainId;

    struct Mandate {
        uint256 chainId;
        address asset;
        address operator;
        address beneficiary;
        uint64 expiresAt;
        uint8 allowedVaults; // bit 0: LiquidVault; bit 1: TimedVault
        uint8 allowedActions; // DEPOSIT=1; WITHDRAW=2
        uint32 maxLockupSeconds;
        uint256 maxDepositPerAction;
        uint256 maxCumulativeDeposits;
        uint256 maxWithdrawPerAction;
        uint256 allocationTarget;
    }

    Mandate private _mandate;
    uint256 public mandateVersion;
    uint256 public cumulativeDeposited;
    uint256 public nextActionNonce;
    bool public allocationCompleted;
    bool public paused;
    bool public revoked;
    mapping(bytes32 => bool) public consumedActionIds;

    error OwnerOnly();
    error OperatorOnly();
    error InvalidConfiguration();
    error InvalidMandate();
    error OpenPosition();
    error InactiveMandate();
    error WrongChain();
    error WrongVersion();
    error InvalidDeadline();
    error Replay();
    error WrongNonce();
    error ActionNotAllowed();
    error TargetNotAllowed();
    error InvalidAmount();
    error DepositLimit();
    error BudgetExceeded();
    error AllocationAlreadyCompleted();
    error WithdrawalLimit();
    error LockupNotAllowed();
    error ExpiryBeforeUnlock();
    error VaultDegraded();
    error UnsupportedToken();

    event MandateSet(
        uint256 indexed version, bytes32 indexed mandateHash, address indexed operator
    );
    event Paused(uint256 indexed version);
    event Resumed(uint256 indexed version);
    event Revoked(uint256 indexed version);
    event Funded(address indexed owner, uint256 amount);
    event ActionExecuted(
        bytes32 indexed actionId,
        uint256 indexed version,
        uint256 nonce,
        uint8 action,
        address indexed target,
        uint256 amount
    );
    event OwnerRecovered(address indexed source, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OwnerOnly();
        _;
    }

    constructor(address accountOwner, address asset, address liquid, address timed) {
        if (
            accountOwner == address(0) || asset.code.length == 0 || liquid.code.length == 0
                || timed.code.length == 0 || liquid == timed
        ) revert InvalidConfiguration();
        if (
            IBoundraVault(liquid).asset() != asset || IBoundraVault(timed).asset() != asset
                || IBoundraVault(liquid).lockupSeconds() != 0
                || IBoundraVault(timed).lockupSeconds() != 30 days
        ) revert InvalidConfiguration();
        owner = accountOwner;
        token = asset;
        liquidVault = liquid;
        timedVault = timed;
        deploymentChainId = block.chainid;
    }

    function mandate() external view returns (Mandate memory) {
        return _mandate;
    }

    function setMandate(Mandate calldata next) external onlyOwner nonReentrant {
        if (block.chainid != deploymentChainId || next.chainId != deploymentChainId) {
            revert WrongChain();
        }
        if (
            next.asset != token || next.beneficiary != owner || next.operator == address(0)
                || next.operator == owner || next.operator == address(this)
                || next.expiresAt <= block.timestamp || next.allowedVaults == 0
                || next.allowedVaults > 3 || next.allowedActions == 0 || next.allowedActions > 3
        ) revert InvalidMandate();
        if (
            (next.allowedActions & DEPOSIT) != 0
                && (next.maxDepositPerAction == 0
                    || next.allocationTarget == 0
                    || next.maxCumulativeDeposits < next.allocationTarget
                    || next.maxDepositPerAction > next.maxCumulativeDeposits)
        ) revert InvalidMandate();
        if ((next.allowedActions & WITHDRAW) != 0 && next.maxWithdrawPerAction == 0) {
            revert InvalidMandate();
        }
        if (
            IBoundraVault(liquidVault).principal(address(this)) != 0
                || IBoundraVault(timedVault).principal(address(this)) != 0
        ) revert OpenPosition();
        _mandate = next;
        mandateVersion++;
        cumulativeDeposited = 0;
        allocationCompleted = false;
        paused = false;
        revoked = false;
        // Nonces and consumed action IDs deliberately never reset across mandate versions.
        emit MandateSet(mandateVersion, keccak256(abi.encode(next)), next.operator);
    }

    function fund(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(owner, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
        emit Funded(owner, amount);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(mandateVersion);
    }

    function revoke() external onlyOwner {
        paused = true;
        revoked = true;
        emit Revoked(mandateVersion);
    }

    function resume() external onlyOwner {
        if (revoked || mandateVersion == 0 || block.timestamp >= _mandate.expiresAt) {
            revert InactiveMandate();
        }
        paused = false;
        emit Resumed(mandateVersion);
    }

    function executeDeposit(
        bytes32 actionId,
        uint256 version,
        uint256 nonce,
        uint64 deadline,
        address target,
        uint256 amount
    ) external nonReentrant {
        _authorize(actionId, version, nonce, deadline, DEPOSIT);
        IBoundraVault vault = _allowedVault(target);
        if (amount == 0) revert InvalidAmount();
        if (amount > _mandate.maxDepositPerAction) revert DepositLimit();
        if (
            amount > _mandate.maxCumulativeDeposits - cumulativeDeposited
                || amount > _mandate.allocationTarget
        ) revert BudgetExceeded();
        if (allocationCompleted) revert AllocationAlreadyCompleted();
        if (vault.riskLevel() != IBoundraVault.RiskLevel.NORMAL) revert VaultDegraded();
        uint256 lockup = vault.lockupSeconds();
        if (lockup > _mandate.maxLockupSeconds) revert LockupNotAllowed();
        if (lockup > 0 && _mandate.expiresAt <= block.timestamp + lockup + EXIT_BUFFER) {
            revert ExpiryBeforeUnlock();
        }
        cumulativeDeposited += amount;
        // Exactly one allocation, including when a user-approved action cap means a partial allocation.
        allocationCompleted = true;
        IERC20 asset = IERC20(token);
        asset.forceApprove(target, amount);
        vault.deposit(amount);
        asset.forceApprove(target, 0);
        emit ActionExecuted(actionId, version, nonce, DEPOSIT, target, amount);
    }

    function executeWithdraw(
        bytes32 actionId,
        uint256 version,
        uint256 nonce,
        uint64 deadline,
        address target,
        uint256 amount
    ) external nonReentrant {
        _authorize(actionId, version, nonce, deadline, WITHDRAW);
        IBoundraVault vault = _allowedVault(target);
        if (amount == 0) revert InvalidAmount();
        if (amount > _mandate.maxWithdrawPerAction) revert WithdrawalLimit();
        vault.withdraw(amount);
        IERC20(token).safeTransfer(owner, amount);
        emit ActionExecuted(actionId, version, nonce, WITHDRAW, target, amount);
    }

    function recoverIdle(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransfer(owner, amount);
        emit OwnerRecovered(address(this), amount);
    }

    function ownerWithdraw(address target, uint256 amount) external onlyOwner nonReentrant {
        // Owner recovery survives expiry/revocation but never bypasses a mock vault's lockup/capacity.
        if (target != liquidVault && target != timedVault) revert TargetNotAllowed();
        if (amount == 0) revert InvalidAmount();
        IBoundraVault(target).withdraw(amount);
        IERC20(token).safeTransfer(owner, amount);
        emit OwnerRecovered(target, amount);
    }

    function _allowedVault(address target) private view returns (IBoundraVault) {
        uint8 mask = target == liquidVault ? 1 : target == timedVault ? 2 : 0;
        if (mask == 0 || (_mandate.allowedVaults & mask) == 0) revert TargetNotAllowed();
        return IBoundraVault(target);
    }

    function _authorize(
        bytes32 actionId,
        uint256 version,
        uint256 nonce,
        uint64 deadline,
        uint8 action
    ) private {
        if (msg.sender != _mandate.operator) revert OperatorOnly();
        if (block.chainid != deploymentChainId) revert WrongChain();
        if (mandateVersion == 0 || paused || revoked || block.timestamp >= _mandate.expiresAt) {
            revert InactiveMandate();
        }
        if (version != mandateVersion) revert WrongVersion();
        if (deadline <= block.timestamp || deadline > _mandate.expiresAt) revert InvalidDeadline();
        if (actionId == bytes32(0) || consumedActionIds[actionId]) revert Replay();
        if (nonce != nextActionNonce) revert WrongNonce();
        if ((_mandate.allowedActions & action) == 0) revert ActionNotAllowed();
        nextActionNonce++;
        consumedActionIds[actionId] = true;
    }
}
