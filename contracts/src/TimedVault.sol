// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockVault} from "./MockVault.sol";

contract TimedVault is MockVault {
    constructor(address token, address admin) MockVault(token, admin, 30 days, 600) {}
}
