import {
  applyAnswer,
  initialState,
  nextQuestion,
  VAULTS,
  type DimensionId,
  type PreferenceState,
} from '@boundra/acce';
import type { LlmProvider, LlmUsage } from '@boundra/llm';
import { z } from 'zod';
import type { PublicPersona } from '../fixtures';

/** The persona's answer to one question (an alternative ID); the only channel to the persona. */
export type Ask = (dimension: DimensionId) => string;

export type Method = 'B0' | 'B1' | 'B2' | 'B3';

export interface Elicitation {
  state: PreferenceState;
  questions: number;
  generator: 'acce' | 'fixed-questionnaire' | 'llm' | 'heuristic-stub';
  usage: LlmUsage;
  failures: string[];
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };
export const PROMPT_VERSION = 'oneshot-v1';

const oneShotSchema = z
  .object({
    acceptsLockup: z.boolean(),
    liquidityNeed: z.enum(['within_30_days', 'not_for_30_days', 'unknown']),
  })
  .strict();
type OneShot = z.infer<typeof oneShotSchema>;

/**
 * Keyword reading of the prompt, used only when no model is configured. Reported as
 * `heuristic-stub`, never as an AI result. Unstated preferences stay unresolved, which the
 * builder treats conservatively, so the stub is not artificially weak.
 */
export function heuristicOneShot(prompt: string): OneShot {
  const text = prompt.toLowerCase();
  const refusesLock = /\b(no|not|without|never|don't|do not)\b[^.]*\block/.test(text);
  const wantsYield = /\b(lock|higher (yield|return)|maximi[sz]e|long[- ]term)\b/.test(text);
  const soon = /\b(tomorrow|soon|any ?time|emergenc|next week|might need|may need)\b/.test(text);
  const later = /\b(won't need|will not need|not need|months|long[- ]term|for a year)\b/.test(text);
  return {
    acceptsLockup: wantsYield && !refusesLock,
    liquidityNeed: soon ? 'within_30_days' : later ? 'not_for_30_days' : 'unknown',
  };
}

function stateFromOneShot(reading: OneShot): PreferenceState {
  let state = applyAnswer(
    initialState(),
    'max_lockup_seconds',
    reading.acceptsLockup ? 'up_to_30_days' : 'no_lockup',
  );
  if (reading.liquidityNeed !== 'unknown')
    state = applyAnswer(
      state,
      'withdrawal_latency_seconds',
      reading.liquidityNeed === 'within_30_days' ? 'within_1_day' : 'not_for_30_days',
    );
  return state;
}

/** B0/B1: one model call turns the free-text goal into preferences, without clarification. */
export async function oneShot(provider: LlmProvider, persona: PublicPersona): Promise<Elicitation> {
  const vaults = Object.values(VAULTS).map((v) => ({
    name: v.name,
    lockupDays: Number(v.lockupSeconds / 86_400n),
    illustrativeYieldPercent: v.illustrativeYieldBps / 100,
  }));
  const result = await provider.generate({
    purpose: `benchmark-${PROMPT_VERSION}`,
    system:
      'You configure a testnet agent wallet mandate from a user goal. Decide whether the user accepts a 30-day lockup and whether they may need the money within 30 days. Answer only from the goal text.',
    prompt: JSON.stringify({
      goal: persona.prompt,
      amountBaseUnits: persona.amount.toString(),
      vaults,
    }),
    schema: oneShotSchema,
  });
  if (result.ok)
    return {
      state: stateFromOneShot(result.value),
      questions: 0,
      generator: 'llm',
      usage: result.usage,
      failures: [],
    };
  return {
    state: stateFromOneShot(heuristicOneShot(persona.prompt)),
    questions: 0,
    generator: 'heuristic-stub',
    usage: result.usage,
    failures: result.reason === 'DISABLED' ? [] : [`LLM_${result.reason}`],
  };
}

/** B2: the same five risk questions for every persona (PRD §13.1). */
export const FIXED_QUESTIONS = [
  'withdrawal_latency_seconds',
  'max_lockup_seconds',
  'leverage',
  'amount',
  'permitted_vaults',
] as const;

export function fixedQuestionnaire(ask: Ask): Elicitation {
  let state = initialState();
  for (const dimension of FIXED_QUESTIONS) {
    // The amount question confirms the requested amount; it does not change preferences.
    if (dimension === 'amount') continue;
    state = applyAnswer(state, dimension, ask(dimension));
  }
  return {
    state,
    questions: FIXED_QUESTIONS.length,
    generator: 'fixed-questionnaire',
    usage: NO_USAGE,
    failures: [],
  };
}

/** B3: adaptive ACCE questions until nothing material remains or the budget is spent. */
export function acce(ask: Ask): Elicitation {
  let state = initialState();
  let asked = 0;
  for (let q = nextQuestion(state, asked); q; q = nextQuestion(state, asked)) {
    state = applyAnswer(state, q.dimension, ask(q.dimension));
    asked++;
  }
  return { state, questions: asked, generator: 'acce', usage: NO_USAGE, failures: [] };
}
