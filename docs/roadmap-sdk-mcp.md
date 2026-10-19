# Roadmap: Boundra for developers and AI agents (SDK and MCP)

Status: **design only, not built.** Everything below "Proposed" is a plan; everything under "What already exists" is in this repository and tested. Testnet only (Base Sepolia, MockUSDC, mock vaults).

## The idea

**Give any AI agent a wallet it cannot misuse.** Today Boundra's own worker is the agent. The limits it works within are not enforced by the agent's good behaviour, though: the owner's executor contract enforces them on chain. Any agent can therefore be the operator, through an SDK for developers or an MCP server for AI assistants, and stay inside the same boundaries.

## What already exists

| Piece                            | Where                                                                     | What it guarantees                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executor contract, one per owner | `contracts/src/BoundraExecutor.sol`                                       | The operator can only `executeDeposit` / `executeWithdraw` within the mandate: allowed vaults, per-action and total caps, a single allocation, maximum lockup, expiry, no deposits into a degraded vault. |
| Operator is any address          | `setMandate`                                                              | The mandate names its operator. Any address except the owner and the executor itself is accepted.                                                                                                         |
| Fixed recipient                  | `executeWithdraw`                                                         | Withdrawals always pay the owner. The operator cannot redirect funds.                                                                                                                                     |
| Replay and staleness protection  | `_authorize`                                                              | Every action needs a fresh action ID, the current nonce and mandate version, and a deadline.                                                                                                              |
| Owner-only control               | `pause`, `resume`, `revoke`, `ownerWithdraw`, `recoverIdle`, `setMandate` | Only the owner can change or stop a mandate or take funds back.                                                                                                                                           |
| Evidence                         | `apps/worker/tests/e2e/full-flow.e2e.ts`                                  | Calls signed with the operator's own key are rejected on chain when they leave the mandate (`BudgetExceeded`, `TargetNotAllowed`, `Replay`, `OperatorOnly`, `OwnerOnly`).                                 |
| Reusable libraries               | `packages/chain`, `packages/acce`                                         | ABIs and mandate hashing; the clarifying-question engine (ACCE) and mandate builder.                                                                                                                      |
| Owner API                        | `docs/api.md`                                                             | Sign in, goal, clarifying questions, draft, approve (returns the exact owner transactions), dashboard, activity.                                                                                          |

## Two audiences, two surfaces

| Audience                          | Surface              | They do                                                                                                                 | They never get                                             |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Developers building agents        | **SDK** (TypeScript) | Set up owners' mandates through Boundra, and run their own agent as the operator.                                       | The owner's key or any way around the mandate.             |
| AI assistants (Claude and others) | **MCP server**       | Read an owner's agent status, help them set a goal, prepare owner actions, and, in operator mode, act within a mandate. | The owner's key. Owner actions are prepared, never signed. |

## Proposed MCP tools

| Tool                                   | Mode        | What it does                                                                                                                                   | Signs?                            |
| -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `boundra_get_overview`                 | owner, read | Agent status, funds, positions, risk warnings                                                                                                  | No                                |
| `boundra_list_activity`                | owner, read | Timeline in plain language, with transaction links only for real transactions                                                                  | No                                |
| `boundra_get_mandate`                  | owner, read | The exact limits in force, and why each was chosen                                                                                             | No                                |
| `boundra_start_goal`                   | owner       | Starts a goal ("Manage 300 MockUSDC safely") and returns the first clarifying question                                                         | No                                |
| `boundra_answer_question`              | owner       | Answers one ACCE question ("not sure" always allowed)                                                                                          | No                                |
| `boundra_prepare_owner_action`         | owner       | Pause, resume, revoke or withdraw: returns the unsigned transaction and a link that opens it in the Boundra app for the owner's wallet to sign | **No, the owner signs**           |
| `boundra_operator_status`              | operator    | Mandates this agent operates and what each still allows                                                                                        | No                                |
| `boundra_deposit` / `boundra_withdraw` | operator    | Submits an action; the executor rejects anything outside the mandate                                                                           | Yes, with the **agent's own** key |

## Proposed SDK shape (illustrative)

```ts
import { Boundra } from '@boundra/sdk'; // proposed package, does not exist yet

// Owner side: the owner's wallet signs; the SDK only prepares.
const boundra = await Boundra.connect({ wallet: ownerWallet, network: 'base-sepolia' });
const goal = await boundra.goals.create({ objective: 'Manage 300 MockUSDC safely', amount: '300' });
await goal.answer('no_lockup');
const draft = await goal.draftMandate({ operator: myAgentAddress });
const txs = await draft.approve(); // setMandate, approve, fund: unsigned
for (const tx of txs) await ownerWallet.sendTransaction(tx);

// Agent side: its own key, bounded by the contract.
const agent = Boundra.operator({ key: agentKey, executor: draft.executor });
const room = await agent.allowance(); // what the mandate still permits
await agent.deposit({ vault: 'LIQUID', amount: room.maxDeposit });
```

## Rules that do not bend

1. **No owner keys, ever.** The SDK and MCP server read state and prepare transactions. The owner signs in their own wallet, which is the same guarantee the web app gives today.
2. **The contract is the boundary.** An operator's key can be stolen or its model can be wrong. The worst case is still bounded by the mandate, and the owner can pause or revoke at any time.
3. **The operator key is the agent's, not Boundra's.** Whoever runs an agent holds its key and is responsible for it. It is never the owner's, deployer's or risk admin's key.
4. **Testnet until audited.** Nothing here touches real funds before an independent audit and real vault integrations.

## What it takes

| Gap                        | Why                                                                                                                                              | Size (rough estimate)           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Non-browser sign-in        | Sessions are bound to the web origin (cookie, CSRF, Origin check). SDK and MCP clients need tokens issued after a wallet signature.              | Small to medium                 |
| Owner-chosen operator      | The API writes Boundra's own `OPERATOR_ADDRESS` into every mandate. It must accept a vetted operator address and show it clearly in the preview. | Medium, needs a security review |
| Public, versioned packages | `@boundra/chain` and `@boundra/acce` are internal workspace packages today.                                                                      | Small                           |
| MCP server                 | Thin layer over the API and contracts, with read tools first.                                                                                    | Small for read-only             |
| Wider action set           | Two mock vaults and one allocation per mandate limit what an agent can usefully do.                                                              | Large, contracts and review     |
| Mainnet                    | Audit, real vaults, legal review.                                                                                                                | Large                           |

## Phases

1. **Read-only MCP** (days): overview, activity and mandate tools, with no signing at all. Safe to demo.
2. **Owner SDK and prepared actions** (1–2 weeks): non-browser sign-in, goal and clarification tools, prepared owner transactions opened in the app to sign.
3. **Bring your own agent** (after a security review): owner-chosen operators, then the operator SDK and MCP operator mode.
4. **Beyond testnet:** audit, real vaults and more actions.

## For the deck (one slide)

- **Next: Boundra for any agent.** The limits live in the owner's executor contract, so any AI agent can be the operator without being trusted.
- **SDK and MCP server:** read status, set goals through clarifying questions, prepare owner actions to sign, and act within a mandate.
- **Never holds owner keys;** the worst case for a stolen agent key is bounded by the mandate. Testnet only until audited.
