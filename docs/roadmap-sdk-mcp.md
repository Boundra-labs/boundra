# Boundra for developers and AI agents (SDK and MCP)

Status: **built and tested on testnet** (phases 1–3 below): API tokens, owner-chosen agents, `@boundra/sdk` and the MCP server. Phase 4 (beyond testnet) has not started. Testnet only: Base Sepolia, MockUSDC, mock vaults.

## The idea

**Give any AI agent a wallet it cannot misuse.** Boundra's own worker is one agent. The limits it works within are not enforced by the agent's good behaviour, though: the owner's executor contract enforces them on chain. Any agent can therefore be the operator, through the SDK for developers or the MCP server for AI assistants, and stay inside the same boundaries.

## What the guarantees rest on

| Piece                            | Where                                                                     | What it guarantees                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executor contract, one per owner | `contracts/src/BoundraExecutor.sol`                                       | The operator can only `executeDeposit` / `executeWithdraw` within the mandate: allowed vaults, per-action and total caps, a single allocation, maximum lockup, expiry, no deposits into a degraded vault. |
| Operator is any address          | `setMandate`                                                              | The mandate names its operator. Any address except the owner and the executor itself is accepted.                                                                                                         |
| Fixed recipient                  | `executeWithdraw`                                                         | Withdrawals always pay the owner. The operator cannot redirect funds.                                                                                                                                     |
| Replay and staleness protection  | `_authorize`                                                              | Every action needs a fresh action ID, the current nonce and mandate version, and a deadline.                                                                                                              |
| Owner-only control               | `pause`, `resume`, `revoke`, `ownerWithdraw`, `recoverIdle`, `setMandate` | Only the owner can change or stop a mandate or take funds back.                                                                                                                                           |

## Two audiences, two surfaces

| Audience                          | Surface                         | They do                                                                                                              | They never get                                             |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Developers building agents        | **`@boundra/sdk`** (TypeScript) | Set up owners' mandates through Boundra, and run their own agent as the operator.                                    | The owner's key or any way around the mandate.             |
| AI assistants (Claude and others) | **MCP server** (`apps/mcp`)     | Read an owner's agent status, help them set a goal, draft mandates, prepare owner actions, and act within a mandate. | The owner's key. Owner actions are prepared, never signed. |

## What was built

| Gap (from the design) | How it was closed                                                                                                                                                                                                                                                                                                                 | Where                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Non-browser sign-in   | API tokens. The owner's wallet signs a "token" SIWE challenge whose statement says the token cannot approve, sign or move funds. Bearer tokens skip CSRF (browsers never send them on their own); tokens and cookies are never interchangeable. Owners create, see and revoke tokens in the app (**Apps & AI**).                  | `apps/api/src/auth`, `apps/web` `/app/connect`, [api.md](./api.md) |
| Owner-chosen operator | Drafts take `operator`. The hashed preview carries `operatorSource: "OWNER"` and leads with a notice that Boundra does not run or vouch for that agent; the review screen says "your own agent". Never a Boundra contract or the risk admin. Boundra's worker keeps monitoring but never transacts for it (`HOLD OWNER_AGENT_*`). | `packages/acce`, `apps/api/src/mandates`, `apps/worker`            |
| SDK                   | `BoundraClient` (owner, API token), `ownerAuthorizationCalls` / `ownerActionCall` (unsigned owner transactions) and `BoundraOperator` (the agent's own key; checks the confirmed mandate and simulates before sending).                                                                                                           | [`packages/sdk`](../packages/sdk/README.md)                        |
| MCP server            | Ten tools over stdio; owner tools need a token, operator tools the agent's key. No tool approves a mandate or signs for the owner.                                                                                                                                                                                                | [`apps/mcp`](../apps/mcp/README.md)                                |
| Public packages       | Workspace packages with builds and READMEs, **not published**: publishing needs a licence decision and `@boundra/shared` and `@boundra/chain` published alongside.                                                                                                                                                                | open                                                               |

## MCP tools

| Tool                                   | Needs       | What it does                                                                                     | Signs?                            |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `boundra_get_overview`                 | owner token | Executor, mandate, funds, positions, chain status                                                | No                                |
| `boundra_list_activity`                | owner token | Timeline, with transaction links only for real transactions                                      | No                                |
| `boundra_get_mandate`                  | owner token | The exact limits in force and the notices the owner sees                                         | No                                |
| `boundra_start_goal`                   | owner token | Starts a goal and returns the first clarifying question                                          | No                                |
| `boundra_answer_question`              | owner token | Records the owner's answer ("unsure" always allowed)                                             | No                                |
| `boundra_draft_mandate`                | owner token | Drafts or revises a mandate, optionally for the owner's own agent; the owner approves in the app | No                                |
| `boundra_prepare_owner_action`         | owner token | Pause, resume, revoke, recoverIdle, ownerWithdraw as an unsigned transaction                     | **No, the owner signs**           |
| `boundra_operator_status`              | agent key   | What a mandate lets this agent do now, per vault, and why not                                    | No                                |
| `boundra_deposit` / `boundra_withdraw` | agent key   | Acts within the mandate; refused before sending, and by the executor on chain, when outside it   | Yes, with the **agent's own** key |

## SDK in brief

```ts
import {
  BoundraClient,
  BoundraOperator,
  isEscalation,
  mockUsdc,
  ownerAuthorizationCalls,
} from '@boundra/sdk';

// Owner side: the owner's wallet signs; the SDK only prepares.
const boundra = await BoundraClient.signIn({ apiUrl, signer: ownerWallet });
let intent = await boundra.startGoal({
  objective: 'Manage 300 MockUSDC safely',
  amount: mockUsdc('300'),
});
// …ask the owner each intent.question, then boundra.answer(…)
const draft = await boundra.draftMandate(intent.id, { operator: myAgent.address });
if (!isEscalation(draft)) {
  const approved = await boundra.approveMandate(draft.id, draft.previewHash); // after the owner reviews
  for (const call of ownerAuthorizationCalls(approved)) await ownerWallet.sendTransaction(call);
}

// Agent side: its own key, bounded by the contract.
const agent = new BoundraOperator({ rpcUrl, manifest, account: myAgent });
const status = await agent.status(ownerAddress);
await agent.deposit({
  owner: ownerAddress,
  vault: 'LIQUID',
  amount: BigInt(status.vaults[0]!.deposit.max),
});
```

## Evidence

- API integration tests: token sign-in and consent wording, altered statements refused, token/cookie separation, admin routes need the browser, token listing and revocation with owner isolation, owner-chosen operators (marked preview, kept across edits, refused addresses, deployments without Boundra's agent).
- Worker integration test: in execute and monitor-only modes the worker never transacts for a mandate naming another agent.
- `@boundra/sdk` chain test on anvil with the real contracts: deposit within the mandate; another agent, another vault, caps and a completed allocation refused before sending; withdrawals paid to the owner; nothing possible while paused.
- MCP tests with a real MCP client: tool sets per configuration, no approve/sign tools, amounts, refusals with code and recovery, configuration errors that never echo values.
- Browser tests: the review screen for an owner's own agent; creating a token (shown once), a foreign-origin challenge never signed, revoking.
- A full-stack run (real API, worker in execute mode, PostgreSQL, contracts on anvil) drove the whole journey through the SDK and the MCP server: token sign-in, executor, clarification, a draft for the owner's own agent, approval and on-chain authorization, the worker standing aside (`HOLD OWNER_AGENT_DEPOSIT`), the agent's deposit, the MCP overview, an MCP with another agent's key refused (`WRONG_OPERATOR`), a withdrawal paid to the owner, and a revoked token rejected.

## Rules that do not bend

1. **No owner keys, ever.** The SDK and MCP server read state and prepare transactions. The owner approves in the app and signs in their own wallet.
2. **The contract is the boundary.** An operator's key can be stolen or its model can be wrong. The worst case is still bounded by the mandate, and the owner can pause or revoke at any time.
3. **The operator key is the agent's, not Boundra's.** Whoever runs an agent holds its key and is responsible for it. It is never the owner's, deployer's or risk admin's key.
4. **Testnet until audited.** Nothing here touches real funds before an independent audit and real vault integrations.

## Phases

1. **Read-only MCP**: done.
2. **Owner SDK and prepared actions**: done (API tokens, goal and clarification tools, prepared owner transactions, approval in the app).
3. **Bring your own agent**: done on testnet (owner-chosen operators, operator SDK, MCP operator tools). An independent security review is still recommended before any wider use.
4. **Beyond testnet**: not started. Audit, real vaults, more actions (two mock vaults and one allocation per mandate limit what an agent can do), publishing the packages, legal review.

## For the deck (one slide)

- **Boundra for any agent.** The limits live in the owner's executor contract, so any AI agent can be the operator without being trusted.
- **SDK and MCP server, working on testnet:** read status, set goals through clarifying questions, draft mandates for the owner's own agent, prepare owner actions to sign, and act within a mandate.
- **Never holds owner keys;** the owner approves in the app and signs in their wallet. A stolen agent key is bounded by the mandate. Testnet only until audited.
