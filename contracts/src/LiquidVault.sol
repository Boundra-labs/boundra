// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockVault} from "./MockVault.sol";

contract LiquidVault is MockVault {
    constructor(address token, address admin) MockVault(token, admin, 0, 300) {}
}
