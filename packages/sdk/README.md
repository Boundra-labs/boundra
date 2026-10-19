# @boundra/sdk

Boundra for developers and AI agents. **Base Sepolia testnet only**: MockUSDC and mock vaults, no real funds.

The SDK has two sides, and neither ever holds the owner's key:

- **Owner side (`BoundraClient`)**: reads an owner's account through the Boundra API, sets a goal, answers the clarifying questions and drafts a mandate for the owner to review. Anything that changes the chain comes back as an unsigned transaction (`OwnerCall`) for the owner's own wallet.
- **Agent side (`BoundraOperator`)**: an agent acts as a mandate's operator with **its own key**. It checks every action against the confirmed on-chain mandate and simulates it before sending. The owner's executor contract enforces the same limits on chain, so a bug or a stolen agent key is still bounded by the mandate.

## Owner side

```ts
import { BoundraClient, isEscalation, mockUsdc, ownerAuthorizationCalls } from '@boundra/sdk';

// The owner's wallet signs a SIWE message saying the token cannot sign transactions or move
// funds. An owner can also create a token in the app ("Connect an app or AI assistant").
const boundra = await BoundraClient.signIn({
  apiUrl: 'https://boundra.example',
  signer: ownerWallet,
});

let intent = await boundra.startGoal({
  objective: 'Manage 300 MockUSDC safely',
  amount: mockUsdc('300'),
});
while (intent.question)
  intent = await boundra.answer(intent.id, intent.question.questionId, 'unsure'); // or the owner's choice

const draft = await boundra.draftMandate(intent.id, { operator: myAgent.address }); // omit for Boundra's agent
if (isEscalation(draft)) throw new Error(draft.reason); // nothing fits; nothing is delegated

// Show the owner draft.preview (operatorSource: 'OWNER' and the first notice say it is their agent).
const approved = await boundra.approveMandate(draft.id, draft.previewHash);
for (const call of ownerAuthorizationCalls(approved)) await ownerWallet.sendTransaction(call);
await boundra.checkAuthorization(draft.id);
```

`ownerActionCall(executor, { kind: 'pause' | 'resume' | 'revoke' | … })` prepares the owner's controls the same way. `BoundraClient` also has `getIntent`, `getMandate`, `reviseMandate` (keeps the agent unless you name another), `dashboard`, `activity`, `registerExecutor` and `signOut` (revokes the token). API errors are `BoundraApiError` with a stable `code` and a `recovery` hint.

## Agent side

```ts
import { BoundraOperator, loadDeploymentManifest, mockUsdc } from '@boundra/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const agent = new BoundraOperator({
  rpcUrl: 'https://sepolia.base.org',
  manifest: loadDeploymentManifest('deploy/manifests/base-sepolia.json'),
  account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`), // the agent's own key
});

const status = await agent.status(ownerAddress); // what the mandate allows right now, per vault
const liquid = status.vaults.find((v) => v.key === 'LIQUID')!;
if (liquid.deposit.refusal === null)
  await agent.deposit({ owner: ownerAddress, vault: 'LIQUID', amount: BigInt(liquid.deposit.max) });
```

Refusals are `BoundraOperatorError` with a `code` (`WRONG_OPERATOR`, `INACTIVE_MANDATE`, `DEPOSIT_LIMIT`, `ALLOCATION_COMPLETED`, …) and a plain-language message. Withdrawals are always paid to the owner. The operator refuses to run as the risk admin.

## Rules that do not bend

1. No owner keys, ever: the owner signs in their own wallet.
2. The contract is the boundary: an agent's worst case is the mandate (allowed vault, caps, expiry, owner as the only recipient), and the owner can pause or revoke at any time.
3. The agent's key belongs to whoever runs the agent. It is never the owner's, the deployer's or the risk admin's key.
4. Testnet until audited.

## Tests

- `pnpm --filter @boundra/sdk test`: the API client and owner transaction encoding.
- `pnpm --filter @boundra/sdk test:e2e:chain`: `BoundraOperator` against the real contracts on a throwaway anvil chain (deposit within the mandate, refusals outside it, withdrawals paid to the owner, pause).

The package is not published to npm yet. Publishing needs a licence decision and publishing `@boundra/shared` and `@boundra/chain` alongside it.
