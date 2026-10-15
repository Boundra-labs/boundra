import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import chain from '../dist/index.js';
const { BoundraChainReader } = chain;

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const hash = `0x${'1'.repeat(64)}`;
const code = '0x6000';
function fixture() {
  const manifest = {
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
        keccak256(code),
      ]),
    ),
  };
  const calls = [];
  const now = BigInt(Math.floor(Date.now() / 1000));
  const client = {
    getChainId: async () => 84532,
    getBlockNumber: async () => 104n,
    getBlock: async () => ({ number: 100n, hash, timestamp: now }),
    getCode: async () => code,
    readContract: async (call) => {
      calls.push(call);
      const { functionName: fn, address } = call;
      const values = {
        token: addr(2),
        liquidVault: addr(4),
        timedVault: addr(5),
        asset: addr(2),
        lockupSeconds: address.toLowerCase() === addr(5) ? 2592000n : 0n,
        owner:
          address.toLowerCase() === addr(2)
            ? addr(3)
            : address.toLowerCase() === addr(7)
              ? addr(8)
              : addr(6),
        decimals: 6,
        executorOf: addr(7),
        deploymentChainId: 84532n,
        mandateVersion: 1n,
        nextActionNonce: 0n,
        cumulativeDeposited: 0n,
        paused: false,
        revoked: false,
        allocationCompleted: false,
        balanceOf: 300000000n,
        principal: 0n,
        unlockAt: 0n,
        maxWithdraw: 0n,
        riskLevel: 0,
        mandate: {
          chainId: 84532n,
          asset: addr(2),
          operator: addr(9),
          beneficiary: addr(8),
          expiresAt: now + 604800n,
          allowedVaults: 1,
          allowedActions: 3,
          maxLockupSeconds: 0,
          maxDepositPerAction: 300000000n,
          maxCumulativeDeposits: 300000000n,
          maxWithdrawPerAction: 300000000n,
          allocationTarget: 300000000n,
        },
      };
      if (!(fn in values)) throw new Error(`Unexpected function ${fn}`);
      return values[fn];
    },
  };
  return { client, manifest, calls };
}

test('reader verifies pinned deployment and owner registration at one confirmed block', async () => {
  const { client, manifest, calls } = fixture();
  const snapshot = await new BoundraChainReader(client, manifest).snapshot(addr(8), addr(7));
  assert.equal(snapshot.blockNumber, 100n);
  assert.equal(snapshot.owner.toLowerCase(), addr(8));
  assert.equal(snapshot.idleBalance, 300000000n);
  assert.ok(calls.length > 20);
  assert.ok(calls.every((call) => call.blockNumber === 100n));
});

test('reader rejects forged code, wrong chain and mismatched factory owner mapping', async () => {
  for (const kind of ['code', 'chain', 'mapping']) {
    const f = fixture();
    if (kind === 'code') f.client.getCode = async () => '0x6001';
    if (kind === 'chain') f.client.getChainId = async () => 1;
    if (kind === 'mapping') {
      const read = f.client.readContract;
      f.client.readContract = (call) =>
        call.functionName === 'executorOf' ? Promise.resolve(addr(99)) : read(call);
    }
    const expected = {
      code: 'UNTRUSTED_BYTECODE',
      chain: 'WRONG_CHAIN',
      mapping: 'UNTRUSTED_EXECUTOR',
    }[kind];
    await assert.rejects(
      () => new BoundraChainReader(f.client, f.manifest).snapshot(addr(8), addr(7)),
      (error) => error.code === expected,
    );
  }
});

test('reader rejects a canonical block change during snapshot acquisition', async () => {
  const f = fixture();
  let reads = 0;
  f.client.getBlock = async () => ({
    number: 100n,
    timestamp: 1800000000n,
    hash: ++reads === 1 ? hash : `0x${'2'.repeat(64)}`,
  });
  await assert.rejects(
    () => new BoundraChainReader(f.client, f.manifest).snapshot(addr(8), addr(7)),
    (error) => error.code === 'OBSERVATION_REORG',
  );
});
