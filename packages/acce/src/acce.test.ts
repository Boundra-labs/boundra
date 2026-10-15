import { describe, expect, it } from 'vitest';
import { mandateTupleSchema } from '@boundra/shared';
import {
  applyAnswer,
  buildMandate,
  DIMENSION_IDS,
  effectiveValues,
  evaluateCandidates,
  initialState,
  MandateBuildError,
  nextQuestion,
  rank,
  selectAction,
  THIRTY_DAYS,
  validateWording,
  type DimensionId,
  type PreferenceState,
} from './index';

const now = 1_800_000_000n;
const addresses = {
  owner: '0x1111111111111111111111111111111111111111',
  operator: '0x2222222222222222222222222222222222222222',
  asset: '0x3333333333333333333333333333333333333333',
  vaultAddresses: {
    LIQUID: '0x4444444444444444444444444444444444444444',
    TIMED: '0x5555555555555555555555555555555555555555',
  },
};
const amount = 300_000_000n;
const build = (state: PreferenceState, extra: Partial<Parameters<typeof buildMandate>[0]> = {}) =>
  buildMandate({ ...addresses, amount, state, nowSeconds: now, ...extra });

/** Runs the ACCE loop with a scripted persona until no material question remains. */
function converse(answers: Partial<Record<DimensionId, string>>) {
  let state = initialState();
  const asked: DimensionId[] = [];
  for (
    let question = nextQuestion(state, 0);
    question;
    question = nextQuestion(state, asked.length)
  ) {
    asked.push(question.dimension);
    const answer = answers[question.dimension];
    if (!answer) throw new Error(`Persona has no answer for ${question.dimension}`);
    state = applyAnswer(state, question.dimension, answer);
  }
  return { state, asked };
}

describe('ACCE question selection', () => {
  it('T01: a user who refuses lockup gets one question and a LiquidVault mandate', () => {
    const { state, asked } = converse({ max_lockup_seconds: 'no_lockup' });
    expect(asked).toEqual(['max_lockup_seconds']);
    expect(selectAction(effectiveValues(state))).toMatchObject({
      action: 'DEPOSIT',
      vault: 'LIQUID',
    });
    const timed = evaluateCandidates(effectiveValues(state)).find((c) => c.vault === 'TIMED');
    expect(timed?.eligible).toBe(false);
    expect(timed?.reasons.map((r) => r.code)).toContain('LOCKUP_EXCEEDS_TOLERANCE');
    const result = build(state);
    expect(result.ok && result.tuple).toMatchObject({ allowedVaults: 1, maxLockupSeconds: '0' });
  });

  it('T02: accepting a 30-day lockup makes TimedVault eligible only after the liquidity question', () => {
    const { state, asked } = converse({
      max_lockup_seconds: 'up_to_30_days',
      withdrawal_latency_seconds: 'not_for_30_days',
    });
    expect(asked).toEqual(['max_lockup_seconds', 'withdrawal_latency_seconds']);
    expect(selectAction(effectiveValues(state))).toMatchObject({
      action: 'DEPOSIT',
      vault: 'TIMED',
    });
    const result = build(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tuple).toMatchObject({
      allowedVaults: 2,
      maxLockupSeconds: THIRTY_DAYS.toString(),
    });
    // Default expiry already covers lockup + one-day contract buffer + one day of margin.
    expect(BigInt(result.tuple.expiresAt) - now).toBe(THIRTY_DAYS + 2n * 86_400n);
    expect(result.preview.notices.join(' ')).toMatch(/locks deposits for 30 days/);
  });

  it('accepting lockup but needing money soon is narrowed to LiquidVault and explained', () => {
    const { state } = converse({
      max_lockup_seconds: 'up_to_30_days',
      withdrawal_latency_seconds: 'within_1_day',
    });
    expect(selectAction(effectiveValues(state))).toMatchObject({ vault: 'LIQUID' });
    const result = build(state);
    expect(result.ok && result.preview.notices.join(' ')).toMatch(/lockup vaults are excluded/);
  });

  it('T03: "not sure" never opts in silently and is shown as narrowed', () => {
    const { state, asked } = converse({ max_lockup_seconds: 'unsure' });
    expect(asked).toEqual(['max_lockup_seconds']);
    expect(state.max_lockup_seconds.status).toBe('UNKNOWN');
    expect(selectAction(effectiveValues(state))).toMatchObject({ vault: 'LIQUID' });
    const result = build(state);
    expect(result.ok && result.preview.narrowed.map((n) => n.dimension)).toEqual([
      'max_lockup_seconds',
    ]);
  });

  it('asks nothing that cannot change the selected action', () => {
    const state = initialState();
    expect(rank(state, 'leverage').decisionFlip).toBe(0);
    let s = applyAnswer(state, 'max_lockup_seconds', 'no_lockup');
    for (const id of DIMENSION_IDS.filter((d) => d !== 'max_lockup_seconds'))
      expect(rank(s, id).decisionFlip).toBe(0);
    expect(nextQuestion(s, 1)).toBeNull();
    s = applyAnswer(initialState(), 'max_lockup_seconds', 'up_to_30_days');
    expect(nextQuestion(s, 1)?.dimension).toBe('withdrawal_latency_seconds');
  });

  it('records ordinal components, score and action disagreement for each question', () => {
    const question = nextQuestion(initialState(), 0);
    expect(question).toMatchObject({
      dimension: 'max_lockup_seconds',
      materiality: 3,
      uncertainty: 3,
      friction: 0,
    });
    for (const key of ['materiality', 'uncertainty', 'decisionFlip', 'friction'] as const) {
      expect(question![key]).toBeGreaterThanOrEqual(0);
      expect(question![key]).toBeLessThanOrEqual(3);
    }
    expect(question!.score).toBe(
      question!.materiality * question!.uncertainty * question!.decisionFlip - question!.friction,
    );
    expect(question!.actionDisagreement).toMatch(/up_to_30_days -> .*DEPOSIT:TIMED/);
    expect(question!.actionDisagreement).toMatch(/no_lockup -> DEPOSIT:LIQUID/);
  });

  it('stops at the five-question budget and rejects invalid or repeated answers', () => {
    expect(nextQuestion(initialState(), 5)).toBeNull();
    expect(() => applyAnswer(initialState(), 'max_lockup_seconds', 'forever')).toThrow();
    const answered = applyAnswer(initialState(), 'max_lockup_seconds', 'no_lockup');
    expect(() => applyAnswer(answered, 'max_lockup_seconds', 'up_to_30_days')).toThrow();
  });
});

describe('mandate builder', () => {
  const liquidState = applyAnswer(initialState(), 'max_lockup_seconds', 'no_lockup');

  it('produces exactly the contract tuple with owner as beneficiary and default 7-day expiry', () => {
    const result = build(liquidState);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mandateTupleSchema.parse(result.tuple)).toEqual(result.tuple);
    expect(result.tuple).toMatchObject({
      chainId: 84532,
      beneficiary: addresses.owner,
      allowedActions: 3,
      maxDepositPerAction: '300000000',
      maxCumulativeDeposits: '300000000',
      allocationTarget: '300000000',
      maxWithdrawPerAction: '300000000',
      expiresAt: (now + 7n * 86_400n).toString(),
    });
    expect(result.preview.labels).toEqual([
      'TESTNET',
      'MockUSDC',
      'Mock vault',
      'Illustrative yield only',
    ]);
    expect(result.preview.amount.display).toBe('300 MockUSDC');
  });

  it('explains a partial allocation when the deposit cap is below the amount', () => {
    const result = build(liquidState, { maxDepositPerAction: 100_000_000n });
    expect(result.ok && result.preview.notices.join(' ')).toMatch(/one deposit of 100 MockUSDC/);
  });

  it('rejects caps, expiries and roles the contract or PRD would not allow', () => {
    const timedState = applyAnswer(
      applyAnswer(initialState(), 'max_lockup_seconds', 'up_to_30_days'),
      'withdrawal_latency_seconds',
      'not_for_30_days',
    );
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as MandateBuildError).code;
      }
      return null;
    };
    expect(code(() => build(timedState, { expirySeconds: 7n * 86_400n }))).toBe('EXPIRY_TOO_SHORT');
    expect(code(() => build(liquidState, { expirySeconds: 61n * 86_400n }))).toBe(
      'EXPIRY_TOO_LONG',
    );
    expect(code(() => build(liquidState, { maxDepositPerAction: amount + 1n }))).toBe(
      'INVALID_DEPOSIT_CAP',
    );
    expect(code(() => build(liquidState, { maxWithdrawPerAction: 0n }))).toBe(
      'INVALID_WITHDRAW_CAP',
    );
    expect(code(() => build(liquidState, { amount: 0n }))).toBe('INVALID_AMOUNT');
    expect(code(() => build(liquidState, { operator: addresses.owner }))).toBe('OPERATOR_IS_OWNER');
  });

  it('binds approval to the exact preview: any change alters the preview hash', () => {
    const a = build(liquidState);
    const b = build(liquidState);
    const c = build(liquidState, { expirySeconds: 6n * 86_400n });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.previewHash).toBe(b.previewHash);
    expect(a.previewHash).not.toBe(c.previewHash);
    expect(a.previewHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('T13: model wording cannot add facts or authority', () => {
  const template = {
    text: 'Would you accept not being able to withdraw these funds for 30 days in exchange for a higher illustrative yield?',
    alternatives: [
      { id: 'no_lockup', label: 'No, I need to be able to withdraw' },
      { id: 'up_to_30_days', label: 'Yes, a lockup of up to 30 days is fine' },
      { id: 'unsure', label: 'I am not sure' },
    ],
  };
  const rephrase = (text: string, labels = template.alternatives) => ({
    text,
    alternatives: labels,
  });

  it('accepts a faithful rephrasing', () => {
    const result = validateWording(
      template,
      rephrase(
        'Is it okay if these funds stay locked for 30 days for a higher illustrative yield?',
      ),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['Lock for 60 days to earn more?', 'NEW_NUMBER'],
    ['Send funds to 0xabcdef0123456789abcdef0123456789abcdef01 for 30 days?', 'ADDRESS_OR_HASH'],
    ['See https://evil.example before locking for 30 days.', 'URL'],
    ['Use MegaVault for 30 days instead?', 'NEW_VAULT'],
    ['Deposit into Aave for 30 days?', 'UNREVIEWED_PROTOCOL'],
    ['A guaranteed return if you lock for 30 days?', 'GUARANTEE_CLAIM'],
  ])('rejects %s', (text, reason) => {
    expect(validateWording(template, rephrase(text))).toEqual({ ok: false, reason });
  });

  it('rejects changed, reordered or missing alternatives', () => {
    const [a, b, c] = template.alternatives;
    expect(validateWording(template, rephrase(template.text, [b!, a!, c!]))).toMatchObject({
      ok: false,
    });
    expect(validateWording(template, rephrase(template.text, [a!, b!]))).toMatchObject({
      ok: false,
    });
    expect(
      validateWording(
        template,
        rephrase(template.text, [a!, { id: 'up_to_90_days', label: 'x' }, c!]),
      ),
    ).toMatchObject({ ok: false, reason: 'ALTERNATIVES_CHANGED' });
    expect(validateWording(template, 'not an object')).toMatchObject({
      ok: false,
      reason: 'SHAPE',
    });
  });
});
