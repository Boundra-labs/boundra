import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient, Prisma } from '../dist/index';

test('PostgreSQL preserves uint256 amounts and rejects duplicate job keys atomically', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const db = createDatabaseClient(process.env.DATABASE_URL);
  const ownerId = randomUUID();
  const key = `integration:${randomUUID()}`;
  try {
    await db.$connect();
    const amount = ((1n << 256n) - 1n).toString();
    await db.walletIdentity.create({
      data: { id: ownerId, address: `0x${randomBytes(20).toString('hex')}` },
    });
    const intent = await db.intent.create({
      data: { ownerId, objective: 'Integration fixture', amount: new Prisma.Decimal(amount) },
    });
    assert.equal(intent.amount.toFixed(0), amount);
    const results = await Promise.allSettled([
      db.job.create({ data: { key, kind: 'fixture', payload: {} } }),
      db.job.create({ data: { key, kind: 'fixture', payload: {} } }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal((rejected.reason as { code?: string }).code, 'P2002');
    assert.equal(await db.job.count({ where: { key } }), 1);
  } finally {
    await db.intent.deleteMany({ where: { ownerId } });
    await db.walletIdentity.deleteMany({ where: { id: ownerId } });
    await db.job.deleteMany({ where: { key } });
    await db.$disconnect();
  }
});
