// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet-only fixture. Faucet, vaults and executor are separate implementation tasks.
contract MockUSDC is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 6;

    error SupplyCapExceeded();

    constructor(address initialOwner)
        ERC20("Boundra Mock USDC", "MockUSDC")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (amount > MAX_SUPPLY - totalSupply()) revert SupplyCapExceeded();
        _mint(to, amount);
    }
}
