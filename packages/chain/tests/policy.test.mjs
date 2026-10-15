import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData } from 'viem';
import chain from '../dist/index.js';
const { prepareAction, deploymentManifestSchema, boundraExecutorAbi } = chain;

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const nowMs = 1800000000000;
function snapshot() {
  return {
    chainId: 84532,
    blockNumber: 100n,
    blockHash: `0x${'1'.repeat(64)}`,
    blockTimestamp: 1800000000n,
    observedAtMs: nowMs,
    owner: addr(1),
    executor: addr(2),
    token: addr(3),
    mandateVersion: 1n,
    nextActionNonce: 0n,
    cumulativeDeposited: 0n,
    idleBalance: 300000000n,
    paused: false,
    revoked: false,
    allocationCompleted: false,
    mandate: {
      chainId: 84532n,
      asset: addr(3),
      operator: addr(4),
      beneficiary: addr(1),
      expiresAt: 1800604800n,
      allowedVaults: 1,
      allowedActions: 3,
      maxLockupSeconds: 0,
      maxDepositPerAction: 300000000n,
      maxCumulativeDeposits: 300000000n,
      maxWithdrawPerAction: 300000000n,
      allocationTarget: 300000000n,
    },
    liquid: {
      address: addr(5),
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 0n,
      riskLevel: 0,
    },
    timed: {
      address: addr(6),
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 2592000n,
      riskLevel: 0,
    },
  };
}
function action() {
  return {
    actionId: `0x${'2'.repeat(64)}`,
    kind: 'DEPOSIT',
    mandateVersion: '1',
    nonce: '0',
    deadline: '1800000060',
    target: addr(5),
    amount: '300000000',
  };
}

test('typed calldata fixes target/action/amount and cannot carry an arbitrary recipient', () => {
  const call = prepareAction(snapshot(), action(), addr(4), nowMs);
  const decoded = decodeFunctionData({ abi: boundraExecutorAbi, data: call.data });
  assert.equal(decoded.functionName, 'executeDeposit');
  assert.equal(decoded.args[5], 300000000n);
  assert.equal(decoded.args[4].toLowerCase(), addr(5));
  assert.throws(() =>
    prepareAction(snapshot(), { ...action(), recipient: addr(9) }, addr(4), nowMs),
  );
});

test('rejects unapproved authority, stale observations, wrong chain/version/nonce and caps', () => {
  const cases = [
    [
      (s) => {
        s.chainId = 1;
      },
      {},
      'WRONG_CHAIN',
    ],
    [
      (s) => {
        s.observedAtMs -= 31000;
      },
      {},
      'STALE_OBSERVATION',
    ],
    [
      (s) => {
        s.blockTimestamp -= 31n;
      },
      {},
      'STALE_OBSERVATION',
    ],
    [
      (s) => {
        s.paused = true;
      },
      {},
      'INACTIVE_MANDATE',
    ],
    [
      (s) => {
        s.revoked = true;
      },
      {},
      'INACTIVE_MANDATE',
    ],
    [
      (s) => {
        s.mandate.beneficiary = addr(9);
      },
      {},
      'INVALID_AUTHORITY',
    ],
    [() => {}, { mandateVersion: '2' }, 'WRONG_VERSION'],
    [() => {}, { nonce: '1' }, 'WRONG_NONCE'],
    [() => {}, { deadline: '1800000000' }, 'INVALID_DEADLINE'],
    [() => {}, { target: addr(9) }, 'UNKNOWN_TARGET'],
    [
      (s) => {
        s.mandate.allowedVaults = 2;
      },
      {},
      'TARGET_NOT_ALLOWED',
    ],
    [
      (s) => {
        s.mandate.allowedActions = 2;
      },
      {},
      'ACTION_NOT_ALLOWED',
    ],
    [
      (s) => {
        s.liquid.riskLevel = 1;
      },
      {},
      'VAULT_DEGRADED',
    ],
    [
      (s) => {
        s.allocationCompleted = true;
      },
      {},
      'ALLOCATION_COMPLETED',
    ],
    [() => {}, { amount: '300000001' }, 'DEPOSIT_LIMIT'],
    [
      (s) => {
        s.cumulativeDeposited = 1n;
      },
      {},
      'BUDGET_EXCEEDED',
    ],
    [
      (s) => {
        s.idleBalance = 1n;
      },
      {},
      'INSUFFICIENT_FUNDING',
    ],
  ];
  for (const [change, override, code] of cases) {
    const s = snapshot();
    change(s);
    assert.throws(
      () => prepareAction(s, { ...action(), ...override }, addr(4), nowMs),
      (e) => e.code === code,
      code,
    );
  }
  assert.throws(
    () => prepareAction(snapshot(), action(), addr(9), nowMs),
    (e) => e.code === 'WRONG_OPERATOR',
  );
});

test('timed deposit needs explicit lockup and actual expiry buffer', () => {
  const s = snapshot();
  s.mandate.allowedVaults = 3;
  const a = { ...action(), target: addr(6) };
  assert.throws(
    () => prepareAction(s, a, addr(4), nowMs),
    (e) => e.code === 'LOCKUP_NOT_ALLOWED',
  );
  s.mandate.maxLockupSeconds = 2592000;
  assert.throws(
    () => prepareAction(s, a, addr(4), nowMs),
    (e) => e.code === 'EXPIRY_BEFORE_UNLOCK',
  );
  s.mandate.expiresAt = 1803456000n;
  assert.equal(prepareAction(s, a, addr(4), nowMs).functionName, 'executeDeposit');
});

test('withdrawal respects principal, capacity and per-action exit limit', () => {
  const s = snapshot();
  s.liquid.principal = 300000000n;
  s.liquid.maxWithdraw = 100000000n;
  const a = { ...action(), kind: 'WITHDRAW' };
  assert.throws(
    () => prepareAction(s, a, addr(4), nowMs),
    (e) => e.code === 'WITHDRAWAL_UNAVAILABLE',
  );
  a.amount = '100000000';
  assert.equal(prepareAction(s, a, addr(4), nowMs).functionName, 'executeWithdraw');
  s.mandate.maxWithdrawPerAction = 1n;
  assert.throws(
    () => prepareAction(s, a, addr(4), nowMs),
    (e) => e.code === 'WITHDRAWAL_LIMIT',
  );
});

test('manifest rejects absent code pins, duplicate addresses and wrong chain', () => {
  const m = {
    chainId: 84532,
    factory: addr(1),
    mockUsdc: addr(2),
    faucet: addr(3),
    liquidVault: addr(4),
    timedVault: addr(5),
    riskAdmin: addr(6),
    deploymentBlock: '1',
    codeHashes: Object.fromEntries(
      ['factory', 'mockUsdc', 'faucet', 'liquidVault', 'timedVault'].map((n) => [
        n,
        `0x${'a'.repeat(64)}`,
      ]),
    ),
  };
  assert.equal(deploymentManifestSchema.safeParse(m).success, true);
  for (const invalid of [
    { ...m, codeHashes: {} },
    { ...m, chainId: 1 },
    { ...m, liquidVault: m.factory },
    { ...m, factory: addr(0) },
  ]) {
    assert.equal(deploymentManifestSchema.safeParse(invalid).success, false);
  }
});
