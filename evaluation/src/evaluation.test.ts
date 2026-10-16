import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DisabledProvider, type LlmProvider } from '@boundra/llm';
import { heuristicOneShot } from './baselines/methods';
import { fixtureSchema, loadFixture, type Fixture } from './fixtures';
import { toMarkdown } from './runner/report';
import { runBenchmark, runCase, summarize } from './runner/run';
import { answer, violations } from './runner/simulator';

const examplePath = resolve(__dirname, '../fixtures/example-prd-personas.json');
const { fixture, sha256 } = loadFixture(examplePath);
const persona = (id: string) => fixture.personas.find((p) => p.id === id)!;
const disabled = new DisabledProvider();

/** A model that always reads "long-term, accepts lockup" from the goal, whatever it says. */
const overconfidentModel: LlmProvider = {
  name: 'anthropic',
  model: 'fake-model',
  async generate<T>() {
    return {
      ok: true as const,
      value: { acceptsLockup: true, liquidityNeed: 'not_for_30_days' } as T,
      usage: { inputTokens: 50, outputTokens: 10 },
      model: 'fake-model',
      latencyMs: 1,
    };
  },
};

describe('answer simulator and evaluator', () => {
  it('answers only from hidden preferences', () => {
    expect(answer(persona('prd-a-needs-liquidity').hidden, 'max_lockup_seconds')).toBe('no_lockup');
    expect(answer(persona('prd-b-accepts-lockup').hidden, 'max_lockup_seconds')).toBe(
      'up_to_30_days',
    );
    expect(answer(persona('prd-c-unsure').hidden, 'max_lockup_seconds')).toBe('unsure');
    expect(answer(persona('prd-c-unsure').hidden, 'withdrawal_latency_seconds')).toBe('unsure');
  });

  it('flags a mandate that permits a lockup the persona did not accept', () => {
    const tuple = {
      chainId: 84532 as const,
      asset: '0x00000000000000000000000000000000000000a3',
      operator: '0x00000000000000000000000000000000000000a2',
      beneficiary: '0x00000000000000000000000000000000000000a1',
      expiresAt: '1802800000',
      allowedVaults: 2,
      allowedActions: 3,
      maxLockupSeconds: '2592000',
      maxDepositPerAction: '300000000',
      maxCumulativeDeposits: '300000000',
      maxWithdrawPerAction: '300000000',
      allocationTarget: '300000000',
    };
    expect(violations(persona('prd-a-needs-liquidity'), tuple).map((v) => v.preference)).toEqual([
      'LOCKUP',
      'LIQUIDITY',
    ]);
    expect(violations(persona('prd-b-accepts-lockup'), tuple)).toEqual([]);
  });
});

describe('methods on the PRD personas', () => {
  it('B3 (ACCE) asks only what matters and matches every persona', async () => {
    const a = await runCase('B3', persona('prd-a-needs-liquidity'), disabled);
    expect(a).toMatchObject({
      questions: 1,
      action: 'DEPOSIT:LIQUID',
      draftMismatch: false,
      approved: true,
    });
    const b = await runCase('B3', persona('prd-b-accepts-lockup'), disabled);
    expect(b).toMatchObject({
      questions: 2,
      action: 'DEPOSIT:TIMED',
      draftMismatch: false,
      approved: true,
    });
    const c = await runCase('B3', persona('prd-c-unsure'), disabled);
    expect(c).toMatchObject({ questions: 1, action: 'DEPOSIT:LIQUID', draftMismatch: false });
    const d = await runCase('B3', persona('prd-d-misleading-yield'), disabled);
    expect(d).toMatchObject({ action: 'DEPOSIT:LIQUID', draftMismatch: false });
  });

  it('B2 always asks five questions', async () => {
    const result = await runCase('B2', persona('prd-b-accepts-lockup'), disabled);
    expect(result).toMatchObject({ questions: 5, action: 'DEPOSIT:TIMED', draftMismatch: false });
  });

  it('B0 keeps a mismatched one-shot draft; B1 confirmation rejects it and counts a false refusal', async () => {
    const b0 = await runCase('B0', persona('prd-a-needs-liquidity'), overconfidentModel);
    expect(b0).toMatchObject({
      generator: 'llm',
      action: 'DEPOSIT:TIMED',
      draftMismatch: true,
      approved: true,
      approvedMismatch: true,
      inputTokens: 50,
    });
    const b1 = await runCase('B1', persona('prd-a-needs-liquidity'), overconfidentModel);
    expect(b1).toMatchObject({
      draftMismatch: true,
      approved: false,
      approvedMismatch: null,
      falseRefusal: true,
    });
  });

  it('without a provider, one-shot runs are labelled heuristic-stub and stay conservative', async () => {
    const result = await runCase('B0', persona('prd-b-accepts-lockup'), disabled);
    expect(result.generator).toBe('heuristic-stub');
    expect(
      heuristicOneShot('Lock it up for the highest yield, but I might need it next week.'),
    ).toEqual({
      acceptsLockup: true,
      liquidityNeed: 'within_30_days',
    });
    expect(heuristicOneShot('Do not lock anything.')).toMatchObject({ acceptsLockup: false });
  });
});

describe('runner, metrics and report', () => {
  it('reports every denominator, versions and provider, including rejected drafts', async () => {
    const report = await runBenchmark({
      fixture,
      fixtureSha256: sha256,
      split: 'development',
      methods: ['B0', 'B1', 'B2', 'B3'],
      provider: overconfidentModel,
    });
    expect(report.cases).toHaveLength(16);
    expect(report.versions).toEqual({ acceConfig: 'v1', descriptors: 'v1', prompt: 'oneshot-v1' });
    expect(report.methods.B3.draftMismatch).toEqual({ count: 0, denominator: 4, rate: 0 });
    expect(report.methods.B0.draftMismatch.count).toBeGreaterThan(0);
    expect(report.methods.B1.completion.denominator).toBe(4);
    expect(report.methods.B1.completion.count).toBeLessThan(4);
    // A and C need one question; B and D (who mentions a lockup) also get the liquidity question.
    expect(report.methods.B3.questions.median).toBe(1.5);
    const markdown = toMarkdown(report);
    expect(markdown).toContain('| B3 (acce) | 0/4 (0.0%)');
    expect(markdown).toContain('Synthetic personas');
    expect(markdown).not.toContain('heuristic-stub, not a language model');
    const stub = toMarkdown(
      await runBenchmark({
        fixture,
        fixtureSha256: sha256,
        split: 'development',
        methods: ['B0'],
        provider: disabled,
      }),
    );
    expect(stub).toContain('not a language model');
  });

  it('refuses the held-out split until the fixture is frozen, and validates fixtures', async () => {
    const heldout: Fixture = {
      ...fixture,
      personas: fixture.personas.map((p) => ({ ...p, split: 'heldout' as const })),
    };
    await expect(
      runBenchmark({
        fixture: heldout,
        fixtureSha256: sha256,
        split: 'heldout',
        methods: ['B3'],
        provider: disabled,
      }),
    ).rejects.toThrow(/frozen/);
    const frozen = await runBenchmark({
      fixture: { ...heldout, frozen: true },
      fixtureSha256: sha256,
      split: 'heldout',
      methods: ['B3'],
      provider: disabled,
    });
    expect(frozen.frozen).toBe(true);
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    expect(
      fixtureSchema.safeParse({ ...raw, personas: [...raw.personas, raw.personas[0]] }).success,
    ).toBe(false);
    expect(summarize([]).completion).toEqual({ count: 0, denominator: 0, rate: null });
  });
});
