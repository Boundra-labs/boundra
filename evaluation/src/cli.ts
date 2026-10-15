import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '@boundra/database';
import { createProvider, readLlmConfig } from '@boundra/llm';
import type { Method } from './baselines/methods';
import { loadFixture } from './fixtures';
import { toMarkdown } from './runner/report';
import { runBenchmark, type RunReport } from './runner/run';

const METHODS: Method[] = ['B0', 'B1', 'B2', 'B3'];

async function persist(report: RunReport, databaseUrl: string) {
  const db = createDatabaseClient(databaseUrl);
  try {
    for (const [method, metrics] of Object.entries(report.methods)) {
      await db.evaluationRun.create({
        data: {
          method,
          split: report.split,
          fixtureVersion: report.fixtureVersion,
          provider: report.provider.name,
          model: report.provider.model,
          promptVersion: report.versions.prompt,
          configVersion: report.versions.acceConfig,
          status: 'COMPLETED',
          metrics: JSON.parse(JSON.stringify(metrics)),
          finishedAt: new Date(),
          cases: {
            create: report.cases
              .filter((c) => c.method === method)
              .map((c) => ({
                personaId: c.personaId,
                outcome: c.approved ? c.action : `NOT_APPROVED:${c.action}`,
                mismatch: c.approvedMismatch,
                questions: c.questions,
                latencyMs: c.latencyMs,
                inputTokens: c.inputTokens,
                outputTokens: c.outputTokens,
                detail: JSON.parse(JSON.stringify(c)),
              })),
          },
        },
      });
    }
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string' },
      split: { type: 'string', default: 'development' },
      methods: { type: 'string', default: METHODS.join(',') },
      out: { type: 'string', default: 'reports' },
      persist: { type: 'boolean', default: false },
    },
  });
  if (!values.fixture) throw new Error('--fixture <path> is required');
  if (values.split !== 'development' && values.split !== 'heldout')
    throw new Error('--split must be development or heldout');
  const methods = values.methods!.split(',').map((m) => m.trim()) as Method[];
  if (methods.some((m) => !METHODS.includes(m))) throw new Error('--methods accepts B0,B1,B2,B3');
  const { fixture, sha256 } = loadFixture(resolve(values.fixture));
  const report = await runBenchmark({
    fixture,
    fixtureSha256: sha256,
    split: values.split,
    methods,
    provider: createProvider(readLlmConfig()),
  });
  const outDir = resolve(values.out!);
  mkdirSync(outDir, { recursive: true });
  const name = `${report.fixtureVersion}-${report.split}-${report.generatedAt.replace(/[:.]/g, '-')}`;
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, `${name}.md`), toMarkdown(report));
  if (values.persist) {
    if (!process.env.DATABASE_URL) throw new Error('--persist needs DATABASE_URL');
    await persist(report, process.env.DATABASE_URL);
  }
  console.log(`Wrote ${join(outDir, name)}.{json,md}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 1;
});
