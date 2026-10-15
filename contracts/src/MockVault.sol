// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBoundraVault} from "./interfaces/IBoundraVault.sol";

/// @notice Controlled testnet fixture: 1:1 principal, no accrued or promised yield.
abstract contract MockVault is IBoundraVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override asset;
    uint256 public immutable override lockupSeconds;
    uint256 public immutable override illustrativeYieldBps;
    RiskLevel public override riskLevel;
    uint256 public override withdrawalCapacity = type(uint256).max;
    uint256 public totalPrincipal;
    mapping(address => uint256) public override principal;
    mapping(address => uint256) public override unlockAt;

    error InvalidAsset();
    error InvalidAmount();
    error DepositsDisabled();
    error UnsupportedToken();
    error PositionLocked(uint256 until);
    error InsufficientPrincipal();
    error InsufficientCapacity();

    event Deposited(address indexed account, uint256 amount, uint256 unlockTimestamp);
    event Withdrawn(address indexed account, uint256 amount);
    event RiskStateChanged(RiskLevel riskLevel, uint256 withdrawalCapacity);

    constructor(address token, address admin, uint256 lockup, uint256 yieldBps) Ownable(admin) {
        if (token.code.length == 0) revert InvalidAsset();
        asset = token;
        lockupSeconds = lockup;
        illustrativeYieldBps = yieldBps;
    }

    function deposit(uint256 amount) external override nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (riskLevel != RiskLevel.NORMAL) revert DepositsDisabled();
        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
        principal[msg.sender] += amount;
        totalPrincipal += amount;
        uint256 until = block.timestamp + lockupSeconds;
        if (until > unlockAt[msg.sender]) unlockAt[msg.sender] = until;
        emit Deposited(msg.sender, amount, unlockAt[msg.sender]);
    }

    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp < unlockAt[msg.sender]) revert PositionLocked(unlockAt[msg.sender]);
        if (amount > principal[msg.sender]) revert InsufficientPrincipal();
        if (amount > withdrawalCapacity) revert InsufficientCapacity();
        principal[msg.sender] -= amount;
        totalPrincipal -= amount;
        if (withdrawalCapacity != type(uint256).max) withdrawalCapacity -= amount;
        if (principal[msg.sender] == 0) unlockAt[msg.sender] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function maxWithdraw(address account) external view override returns (uint256) {
        if (block.timestamp < unlockAt[account]) return 0;
        uint256 amount = principal[account];
        return amount < withdrawalCapacity ? amount : withdrawalCapacity;
    }

    /// @notice Demo admin can simulate protocol conditions, never transfer positions.
    function setRiskState(RiskLevel level, uint256 capacity) external onlyOwner {
        riskLevel = level;
        withdrawalCapacity = capacity;
        emit RiskStateChanged(level, capacity);
    }
}
