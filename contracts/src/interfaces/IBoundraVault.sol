// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IBoundraVault {
    enum RiskLevel {
        NORMAL,
        DEGRADED
    }

    function asset() external view returns (address);
    function lockupSeconds() external view returns (uint256);
    function illustrativeYieldBps() external view returns (uint256);
    function riskLevel() external view returns (RiskLevel);
    function withdrawalCapacity() external view returns (uint256);
    function principal(address account) external view returns (uint256);
    function unlockAt(address account) external view returns (uint256);
    function maxWithdraw(address account) external view returns (uint256);
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
}
