# Execution evidence: Base Sepolia

Real transactions from one owner journey on the deployed app (`https://boundra-api.onrender.com`), on Base Sepolia (chain 84532) against the reviewed deployment in `deploy/manifests/base-sepolia.json`. Every hash below was read back from the chain: sender, target and status (all **success**).

- **Owner:** `0xEcc070725898eb3aaea8448b16272eE6E56c5e81`
- **Owner's executor:** [`0x0e4c01b7fAc2e45a2a38eA7B9A0744D4eF0e9E2E`](https://sepolia.basescan.org/address/0x0e4c01b7fAc2e45a2a38eA7B9A0744D4eF0e9E2E), created by the factory for this owner
- **Boundra's agent (operator):** [`0x7d8616836B3fC6FFABE090a4d3658e5a5C3A87F1`](https://sepolia.basescan.org/address/0x7d8616836B3fC6FFABE090a4d3658e5a5C3A87F1)
- **Mandate:** 300 MockUSDC into LiquidVault, withdraw at any time, chosen through ACCE's clarifying question

## The agent acting on its own

| Block    | Sender    | Call                                                                          | Transaction                                                                                                              |
| -------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 48368303 | **Agent** | `executeDeposit`: 300 MockUSDC into LiquidVault, within the confirmed mandate | [`0xb9e053eb…0100b`](https://sepolia.basescan.org/tx/0xb9e053eb35b4780703d9d6e6e79f045d3401fb219afea3c6789471574740100b) |

The worker proposed, checked, simulated, signed and sent this deposit without any owner prompt, 11 blocks after the executor was funded. It is the only transaction the agent sent for this mandate: the single allocation was then complete, so it held.

## The owner's transactions

| Block    | Call                                                                 | Transaction                                                                                                              |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 48368221 | Faucet `claim`: test MockUSDC                                        | [`0x74f57e9d…04fc0`](https://sepolia.basescan.org/tx/0x74f57e9df29dab05d4aab933cf296c8f5d5e32afb02cabda189c536464c04fc0) |
| 48368230 | Factory `createExecutor`                                             | [`0x815efb6f…18808`](https://sepolia.basescan.org/tx/0x815efb6f67f5db80d164689e9ef13ce405d91fe9eab271f286b287b682a18808) |
| 48368265 | Executor `setMandate`: the approved tuple                            | [`0xe648e4e4…1797d`](https://sepolia.basescan.org/tx/0xe648e4e4b2e0717c0fa014da53f87024cb78d7d05edb7543fb23579b3041797d) |
| 48368283 | MockUSDC `approve` (exact amount, for the executor)                  | [`0x4f360968…53b0d`](https://sepolia.basescan.org/tx/0x4f3609689d393939bad1eee1766d37abee5a4c0b75c5ac770bea1a7a4f453b0d) |
| 48368292 | Executor `fund`                                                      | [`0xf67668a0…99300`](https://sepolia.basescan.org/tx/0xf67668a01d46122526af2eafe582511e570ddf833fea7d3764269ff17c599300) |
| 48368321 | MockUSDC `approve` (second funding)                                  | [`0xe1704fcc…f9b05`](https://sepolia.basescan.org/tx/0xe1704fcc1ea7919da1b3489af32237b76120c0063b6456343bfa4d2d59af9b05) |
| 48368328 | Executor `fund` (second funding)                                     | [`0x23e0c927…73151`](https://sepolia.basescan.org/tx/0x23e0c927b0fc41cbf3844d806769897c128f85f2265fa1183fd7ba48ee473151) |
| 48368357 | Executor `pause`: the agent stops                                    | [`0xdfd3c2ef…babc7`](https://sepolia.basescan.org/tx/0xdfd3c2eff130eb00fbf0e8cb09b9b4ba7d95db840691d43d66e7d1e8133babc7) |
| 48368373 | Executor `pause` (repeated)                                          | [`0xc0bd4257…8bb91`](https://sepolia.basescan.org/tx/0xc0bd425776bd4bc5783cfd92c555d7e7f50ed3455ddf3de09c561c482458bb91) |
| 48368382 | Executor `resume`                                                    | [`0xb7251b4d…d1abe`](https://sepolia.basescan.org/tx/0xb7251b4d5495e56506c26366718648689144019a1edb7cbfe8f0f28b6e7d1abe) |
| 48368389 | Executor `resume` (repeated)                                         | [`0x2ab19ea3…ffdf5`](https://sepolia.basescan.org/tx/0x2ab19ea34d287c9f8f242ddb2c79aff38d6010fabcbf05017a80e21b8e8ffdf5) |
| 48368396 | Executor `recoverIdle`: idle funds back to the owner                 | [`0x56efae44…7c564`](https://sepolia.basescan.org/tx/0x56efae44fc317b28e958f5e99e56743cbf553dd26f6b0999dd28e5a94117c564) |
| 48368408 | Executor `ownerWithdraw`: the LiquidVault position back to the owner | [`0xef7e0b9a…9d9e9`](https://sepolia.basescan.org/tx/0xef7e0b9a59098e90d42fec06446533bc332715c9540953de96f4e32a1829d9e9) |
| 48368417 | Executor `revoke`: the agent can never act on this mandate again     | [`0x7dbd39a2…9960c`](https://sepolia.basescan.org/tx/0x7dbd39a2384c624bd5fa784e40fb4b835f5097e423db27e739a111502699960c) |
| 48368421 | Executor `revoke` (repeated)                                         | [`0xce1de144…58812`](https://sepolia.basescan.org/tx/0xce1de1440d4084d9ffee8929a4f8a22f2e482320f02eed6b957bca5d0e958812) |

The repeated pause, resume and revoke were sent because the web app did not show the new state until the page was reloaded; the first transaction of each pair had already taken effect. Both transactions of each pair succeed on chain.

## What this shows

1. **The owner keeps every key.** Every owner transaction above was signed in the owner's own wallet; Boundra's server never held the owner's key.
2. **The agent acts alone, within the mandate.** The deposit was signed with the agent's own key and accepted by the executor only because it matched the confirmed mandate: the allowed vault, the caps and the single allocation.
3. **The owner stays in control.** Pause and resume stopped and restarted the agent; the owner recovered the idle funds and the vault position directly; revoke ended the mandate for good.
4. **Funds only return to the owner.** Both recoveries paid the owner's wallet.

## How to re-check

Each hash opens on [sepolia.basescan.org](https://sepolia.basescan.org). With Foundry, for example: `cast receipt <hash> status --rpc-url https://sepolia.base.org` returns `1 (success)`, and `cast tx <hash> from --rpc-url https://sepolia.base.org` returns the sender shown above.
