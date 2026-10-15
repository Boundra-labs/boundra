// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BoundraExecutor} from "../src/BoundraExecutor.sol";

/// @notice Pins the off-chain `hashMandate` helper (packages/chain) to the executor's encoding.
contract MandateHashTest {
    function testOffchainMandateHashMatchesExecutorEncoding() public pure {
        BoundraExecutor.Mandate memory m = BoundraExecutor.Mandate({
            chainId: 84532,
            asset: 0x3333333333333333333333333333333333333333,
            operator: 0x2222222222222222222222222222222222222222,
            beneficiary: 0x1111111111111111111111111111111111111111,
            expiresAt: 1_800_604_800,
            allowedVaults: 2,
            allowedActions: 3,
            maxLockupSeconds: 2_592_000,
            maxDepositPerAction: 100e6,
            maxCumulativeDeposits: 300e6,
            maxWithdrawPerAction: 200e6,
            allocationTarget: 300e6
        });
        // Value produced by hashMandate() in packages/chain/tests/policy.test.mjs.
        require(
            keccak256(abi.encode(m))
                == 0x33b6cb5eb481c9a9b5424c7368387a9e7e6506531027456fec2e99aae241edaa,
            "Off-chain mandate hash diverged from executor encoding"
        );
    }
}
