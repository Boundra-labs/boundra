/**
 * BoundraOperator against the real contracts on a throwaway local anvil chain (ID 84532): the
 * owner's wallet sets a mandate naming the agent's own key, then the agent acts within it and is
 * refused outside it. Anvil's development accounts are public test keys, never used on a real
 * network; the agent's key is generated per run.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { createPublicClient, createWalletClient, getAddress, http, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { boundraFactoryAbi, mockUsdcAbi } from '@boundra/chain';
import {
  devAccount,
  deployBoundra,
  fundGas,
  startAnvil,
} from '../../../scripts/lib/local-chain.mjs';
import {
  BoundraOperator,
  BoundraOperatorError,
  createExecutorCall,
  faucetClaimCall,
  mockUsdc,
  ownerActionCall,
  ownerAuthorizationCalls,
  type ApprovedMandate,
  type OwnerCall,
} from '../src';

const owner = devAccount(2);
const agent = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
let anvil: ChildProcess;
let rpc: string;
let work: string;
let manifest: Awaited<ReturnType<typeof deployBoundra>>['manifest'];
let executor: Address;

const reader = () => createPublicClient({ chain: baseSepolia, transport: http(rpc) });

/** The owner's own wallet sends each prepared call, as MetaMask would after review. */
async function ownerSends(calls: OwnerCall[]) {
  const wallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(rpc) });
  for (const call of calls) {
    const hash = await wallet.sendTransaction({ to: call.to, data: call.data });
    const receipt = await reader().waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', call.description);
  }
}

const balanceOf = (address: Address) =>
  reader().readContract({
    address: getAddress(manifest.mockUsdc),
    abi: mockUsdcAbi,
    functionName: 'balanceOf',
    args: [address],
  });

async function refused(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof BoundraOperatorError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

before(async () => {
  ({ anvil, rpc } = await startAnvil({ port: 9100 + Math.floor(Math.random() * 400) }));
  work = mkdtempSync(join(tmpdir(), 'boundra-sdk-'));
  ({ manifest } = await deployBoundra({ rpc, workDir: work }));
  await fundGas({ rpc, addresses: [agent.address, stranger.address], ether: '1' });

  await ownerSends([
    faucetClaimCall(getAddress(manifest.faucet)),
    createExecutorCall(getAddress(manifest.factory)),
  ]);
  executor = await reader().readContract({
    address: getAddress(manifest.factory),
    abi: boundraFactoryAbi,
    functionName: 'executorOf',
    args: [owner.address],
  });
  // What the API returns on approval: LiquidVault only, 300 MockUSDC, at most 100 per withdrawal.
  const block = await reader().getBlock();
  const tuple = {
    chainId: 84532 as const,
    asset: manifest.mockUsdc.toLowerCase(),
    operator: agent.address.toLowerCase(),
    beneficiary: owner.address.toLowerCase(),
    expiresAt: (block.timestamp + 7n * 86_400n).toString(),
    allowedVaults: 1,
    allowedActions: 3,
    maxLockupSeconds: '0',
    maxDepositPerAction: mockUsdc('300').toString(),
    maxCumulativeDeposits: mockUsdc('300').toString(),
    maxWithdrawPerAction: mockUsdc('100').toString(),
    allocationTarget: mockUsdc('300').toString(),
  };
  const amount = mockUsdc('300').toString();
  await ownerSends(
    ownerAuthorizationCalls({
      ownerTransactions: {
        note: '',
        setMandate: { to: executor, functionName: 'setMandate', args: [tuple] },
        approve: { to: manifest.mockUsdc, functionName: 'approve', args: [executor, amount] },
        fund: { to: executor, functionName: 'fund', args: [amount] },
      },
    } as unknown as ApprovedMandate),
  );
});

after(() => {
  anvil?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
});

test('the agent sees exactly what the mandate allows it to do', async () => {
  const operator = new BoundraOperator({ rpcUrl: rpc, manifest, account: agent });
  const status = await operator.status(owner.address);
  assert.equal(status.isOperator, true);
  assert.equal(status.active, true);
  assert.equal(status.executor, executor);
  const [liquid, timed] = status.vaults;
  assert.deepEqual(liquid!.deposit, { max: mockUsdc('300').toString(), refusal: null });
  assert.equal(timed!.allowedByMandate, false);
  assert.deepEqual(timed!.deposit, { max: '0', refusal: 'TARGET_NOT_ALLOWED' });
  assert.equal(liquid!.withdraw.refusal, 'WITHDRAWAL_UNAVAILABLE');
});

test('another agent and other vaults are refused before anything is sent', async () => {
  const intruder = new BoundraOperator({ rpcUrl: rpc, manifest, account: stranger });
  const sentBefore = await reader().getTransactionCount({ address: stranger.address });
  await refused(
    intruder.deposit({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('1') }),
    'WRONG_OPERATOR',
  );
  assert.equal(await reader().getTransactionCount({ address: stranger.address }), sentBefore);
  const operator = new BoundraOperator({ rpcUrl: rpc, manifest, account: agent });
  await refused(
    operator.deposit({ owner: owner.address, vault: 'TIMED', amount: mockUsdc('1') }),
    'TARGET_NOT_ALLOWED',
  );
  await refused(
    operator.deposit({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('301') }),
    'DEPOSIT_LIMIT',
  );
  await refused(operator.status(stranger.address), 'NO_EXECUTOR');
});

test('the agent deposits within the mandate, and withdrawals always pay the owner', async () => {
  const operator = new BoundraOperator({ rpcUrl: rpc, manifest, account: agent });
  const deposit = await operator.deposit({
    owner: owner.address,
    vault: 'LIQUID',
    amount: mockUsdc('300'),
  });
  assert.match(deposit.txHash, /^0x[0-9a-f]{64}$/);
  let status = await operator.status(owner.address);
  assert.equal(status.allocationCompleted, true);
  assert.equal(status.vaults[0]!.principal, mockUsdc('300').toString());
  assert.equal(status.vaults[0]!.deposit.refusal, 'ALLOCATION_COMPLETED');
  await refused(
    operator.deposit({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('1') }),
    'ALLOCATION_COMPLETED',
  );
  await refused(
    operator.withdraw({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('150') }),
    'WITHDRAWAL_LIMIT',
  );

  const before = await balanceOf(owner.address);
  const agentBefore = await balanceOf(agent.address);
  await operator.withdraw({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('100') });
  assert.equal((await balanceOf(owner.address)) - before, mockUsdc('100'));
  assert.equal(await balanceOf(agent.address), agentBefore);
  status = await operator.status(owner.address);
  assert.equal(status.vaults[0]!.principal, mockUsdc('200').toString());
});

test('once the owner pauses, the agent can do nothing until they resume', async () => {
  const operator = new BoundraOperator({ rpcUrl: rpc, manifest, account: agent });
  await ownerSends([ownerActionCall(executor, { kind: 'pause' })]);
  assert.equal((await operator.status(owner.address)).active, false);
  await refused(
    operator.withdraw({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('10') }),
    'INACTIVE_MANDATE',
  );
  await ownerSends([ownerActionCall(executor, { kind: 'resume' })]);
  await operator.withdraw({ owner: owner.address, vault: 'LIQUID', amount: mockUsdc('10') });
});

test('the agent cannot be the risk admin', () => {
  assert.throws(
    () => new BoundraOperator({ rpcUrl: rpc, manifest, account: devAccount(1) }),
    /must not be the risk admin/,
  );
});
