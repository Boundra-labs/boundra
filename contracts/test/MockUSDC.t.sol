// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "../src/MockUSDC.sol";

contract UnauthorizedMinter {
    function tryMint(MockUSDC token) external returns (bool) {
        (bool success,) = address(token).call(abi.encodeCall(token.mint, (address(this), 1)));
        return success;
    }
}

contract MockUSDCTest {
    function testDecimalsAndExactPrincipal() public {
        MockUSDC token = new MockUSDC(address(this));
        token.mint(address(this), 300 * 10 ** 6);
        require(token.decimals() == 6, "Wrong decimals");
        require(token.balanceOf(address(this)) == 300 * 10 ** 6, "Wrong base-unit amount");
    }

    function testUnauthorizedMintRejected() public {
        MockUSDC token = new MockUSDC(address(this));
        UnauthorizedMinter attacker = new UnauthorizedMinter();
        require(!attacker.tryMint(token), "Unauthorized mint succeeded");
        require(token.totalSupply() == 0, "Supply changed");
    }

    function testSupplyCapRejected() public {
        MockUSDC token = new MockUSDC(address(this));
        token.mint(address(this), token.MAX_SUPPLY());
        (bool success,) = address(token).call(abi.encodeCall(token.mint, (address(this), 1)));
        require(!success, "Supply cap bypassed");
    }

    function testFuzzMintWithinCap(uint96 rawAmount) public {
        MockUSDC token = new MockUSDC(address(this));
        uint256 amount = uint256(rawAmount) % (token.MAX_SUPPLY() + 1);
        token.mint(address(this), amount);
        require(token.balanceOf(address(this)) == amount, "Mint amount mismatch");
        require(token.totalSupply() <= token.MAX_SUPPLY(), "Supply invariant failed");
    }
}
