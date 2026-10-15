import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient, type PrismaClient } from '../dist/index';

const hex = (bytes: number) => `0x${randomBytes(bytes).toString('hex')}`;
const address = () => hex(20);
const hash = () => hex(32);
let db: PrismaClient;
const owners: string[] = [];

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  db = createDatabaseClient(process.env.DATABASE_URL);
  await db.$connect();
});

after(async () => {
  for (const ownerId of owners) {
    const mandates = await db.mandate.findMany({ where: { ownerId }, select: { id: true } });
    const mandateIds = mandates.map((m) => m.id);
    const actions = await db.actionProposal.findMany({
      where: { mandateId: { in: mandateIds } },
      select: { actionId: true },
    });
    await db.policyCheck.deleteMany({
      where: { actionId: { in: actions.map((a) => a.actionId) } },
    });
    await db.actionProposal.deleteMany({ where: { mandateId: { in: mandateIds } } });
    await db.decision.deleteMany({ where: { mandateId: { in: mandateIds } } });
    await db.mandate.deleteMany({ where: { ownerId } });
    await db.executor.deleteMany({ where: { ownerId } });
    await db.question.deleteMany({ where: { intent: { ownerId } } });
    await db.intent.deleteMany({ where: { ownerId } });
    await db.walletIdentity.deleteMany({ where: { id: ownerId } });
  }
  await db.$disconnect();
});

async function fixture() {
  const ownerId = randomUUID();
  owners.push(ownerId);
  const owner = address();
  await db.walletIdentity.create({ data: { id: ownerId, address: owner } });
  const intent = await db.intent.create({
    data: { ownerId, objective: 'Schema fixture', amount: '300000000' },
  });
  const executor = await db.executor.create({
    data: { ownerId, address: address(), factory: address(), verifiedAtBlock: '100' },
  });
  return { ownerId, owner, intent, executor };
}

function mandateData(f: Awaited<ReturnType<typeof fixture>>, revision: number) {
  return {
    intentId: f.intent.id,
    ownerId: f.ownerId,
    executorId: f.executor.id,
    revision,
    asset: address(),
    operator: address(),
    beneficiary: f.owner,
    expiresAt: '1800000000',
    allowedVaults: 1,
    allowedActions: 3,
    maxLockupSeconds: 0n,
    maxDepositPerAction: '300000000',
    maxCumulativeDeposits: '300000000',
    maxWithdrawPerAction: '300000000',
    allocationTarget: '300000000',
  };
}

async function proposal(
  f: Awaited<ReturnType<typeof fixture>>,
  mandateId: string,
  contractNonce: string,
  proposalSeq = 0,
) {
  const decision = await db.decision.create({
    data: {
      mandateId,
      kind: 'DEPOSIT',
      trigger: 'fixture',
      reasonCode: 'FIXTURE',
      reasonSummary: 'Fixture',
      candidates: [],
      snapshotBlock: '100',
      snapshotBlockHash: hash(),
      policyVersion: 'v1',
    },
  });
  return db.actionProposal.create({
    data: {
      actionId: hash(),
      decisionId: decision.id,
      mandateId,
      executor: f.executor.address,
      onchainVersion: '1',
      contractNonce,
      proposalSeq,
      kind: 'DEPOSIT',
      target: address(),
      amount: '300000000',
      deadline: '1800000060',
      envelope: {},
    },
  });
}

const rejectsWithCheck = (promise: Promise<unknown>) =>
  assert.rejects(promise, (error: unknown) => /constraint|violat/i.test(String(error)));

test('only one mandate per executor can be AUTHORIZED at a time', async () => {
  const f = await fixture();
  const first = await db.mandate.create({ data: { ...mandateData(f, 1), status: 'AUTHORIZED' } });
  const second = await db.mandate.create({ data: mandateData(f, 2) });
  await rejectsWithCheck(
    db.mandate.update({ where: { id: second.id }, data: { status: 'AUTHORIZED' } }),
  );
  await db.mandate.update({ where: { id: first.id }, data: { status: 'SUPERSEDED' } });
  await db.mandate.update({ where: { id: second.id }, data: { status: 'AUTHORIZED' } });
});

test('an executor has at most one non-terminal action; terminal actions free the slot', async () => {
  const f = await fixture();
  const mandate = await db.mandate.create({ data: mandateData(f, 1) });
  const active = await proposal(f, mandate.id, '0');
  await rejectsWithCheck(proposal(f, mandate.id, '1'));
  await db.actionProposal.update({
    where: { actionId: active.actionId },
    data: { state: 'CONFIRMED' },
  });
  await proposal(f, mandate.id, '1');
  // The same contract nonce and sequence can never be proposed twice.
  await assert.rejects(proposal(f, mandate.id, '1'));
});

test('canonical formats and contract bounds are enforced by the database', async () => {
  const f = await fixture();
  await rejectsWithCheck(
    db.executor.update({
      where: { id: f.executor.id },
      data: { address: `0x${'A'.repeat(40)}` },
    }),
  );
  await rejectsWithCheck(
    db.mandate.create({ data: { ...mandateData(f, 1), expiresAt: (1n << 64n).toString() } }),
  );
  await rejectsWithCheck(
    db.mandate.create({ data: { ...mandateData(f, 1), maxLockupSeconds: 1n << 32n } }),
  );
  await rejectsWithCheck(db.mandate.create({ data: { ...mandateData(f, 1), allowedVaults: 4 } }));
  await rejectsWithCheck(
    db.mandate.create({
      data: { ...mandateData(f, 1), maxDepositPerAction: (1n << 256n).toString() },
    }),
  );
  await rejectsWithCheck(
    db.question.create({
      data: {
        intentId: f.intent.id,
        questionId: `q-${randomUUID()}`,
        order: 1,
        dimension: 'max_lockup_seconds',
        alternatives: [],
        actionDisagreement: 'fixture',
        materiality: 4,
        uncertainty: 1,
        decisionFlip: 1,
        friction: 0,
        score: 4,
        text: 'fixture',
        wordingSource: 'TEMPLATE',
      },
    }),
  );
});

test('an EOA nonce can be reserved again only after release', async () => {
  const operator = address();
  const reserve = (actionId: string) =>
    db.eoaNonceReservation.create({
      data: { chainId: 84532, operator, eoaNonce: 7n, actionId, fencingToken: 1n },
    });
  const first = await reserve(hash());
  try {
    await rejectsWithCheck(reserve(hash()));
    await db.eoaNonceReservation.update({ where: { id: first.id }, data: { status: 'RELEASED' } });
    const second = await reserve(hash());
    await db.eoaNonceReservation.delete({ where: { id: second.id } });
  } finally {
    await db.eoaNonceReservation.delete({ where: { id: first.id } });
  }
});
