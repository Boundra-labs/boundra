// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
    function chainId(uint256 newChainId) external;
    function targetContract(address target) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant OWNER = address(0xA11CE);
    address internal constant OPERATOR = address(0xB0B);
    address internal constant ATTACKER = address(0xBAD);
}
