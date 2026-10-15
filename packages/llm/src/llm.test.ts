import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  buildMandate,
  initialState,
  nextQuestion,
  type PlannedQuestion,
} from '@boundra/acce';
import {
  AnthropicProvider,
  createProvider,
  DisabledProvider,
  readLlmConfig,
  summarizeMandate,
  TokenBudget,
  wordQuestion,
  type MessagesClient,
} from './index';

const question = nextQuestion(initialState(), 0) as PlannedQuestion;
const usage = { input_tokens: 120, output_tokens: 40 };

function fakeClient(response: unknown | (() => unknown)) {
  const calls: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          calls.push({ params, options });
          return typeof response === 'function' ? (response as () => unknown)() : response;
        },
      },
    },
  } as unknown as MessagesClient;
  return { client, calls };
}

const provider = (
  client: MessagesClient,
  model = 'claude-opus-5-5',
  budget = new TokenBudget(100_000),
) => new AnthropicProvider({ client, model, deadlineMs: 20_000, maxOutputTokens: 4_000, budget });

const reply = (parsed: unknown, stop_reason = 'end_turn') => ({
  parsed_output: parsed,
  stop_reason,
  usage,
  model: 'claude-opus-5-5',
});

describe('question wording', () => {
  it('uses validated model wording and sends a bounded, fallback-enabled request', async () => {
    const parsed = {
      text: 'Would a 30-day lockup be okay in exchange for a higher illustrative yield?',
      alternatives: question.alternatives,
    };
    const { client, calls } = fakeClient(reply(parsed));
    const result = await wordQuestion(provider(client), question);
    expect(result).toMatchObject({ source: 'LLM', fallbackReason: null, value: parsed });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    const [{ params, options }] = calls;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
    });
    expect(options).toMatchObject({ maxRetries: 2, timeout: 10_000 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // The model only sees the template question and its alternatives.
    expect(
      JSON.parse(
        params.messages instanceof Array ? (params.messages[0] as { content: string }).content : '',
      ),
    ).toEqual({
      question: question.text,
      alternatives: question.alternatives,
    });
  });

  it('does not request server-side fallback for Haiku models', async () => {
    const { client, calls } = fakeClient(
      reply({ text: question.text, alternatives: question.alternatives }),
    );
    await wordQuestion(provider(client, 'claude-haiku-5-5'), question);
    expect(calls[0]!.params.fallbacks).toBeUndefined();
    expect(calls[0]!.params.betas).toBeUndefined();
  });

  it.each([
    ['refusal', reply(null, 'refusal'), 'REFUSAL'],
    ['truncated', reply({ text: 'x', alternatives: [] }, 'max_tokens'), 'INVALID_OUTPUT'],
    ['malformed', reply({ text: 1 }), 'INVALID_OUTPUT'],
    [
      'injected fact',
      reply({
        text: 'Lock for 90 days at MegaVault for more?',
        alternatives: question.alternatives,
      }),
      'NEW_NUMBER',
    ],
    [
      'changed options',
      reply({ text: question.text, alternatives: [...question.alternatives].reverse() }),
      'ALTERNATIVES_CHANGED',
    ],
  ])('falls back to the template on %s', async (_label, response, reason) => {
    const { client } = fakeClient(response);
    const result = await wordQuestion(provider(client), question);
    expect(result).toMatchObject({ source: 'TEMPLATE', fallbackReason: reason });
    expect(result.value).toEqual({ text: question.text, alternatives: question.alternatives });
  });

  it('treats timeouts and provider errors as fallbacks, never as failures of the flow', async () => {
    const timeout = fakeClient(() => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    expect((await wordQuestion(provider(timeout.client), question)).fallbackReason).toBe('TIMEOUT');
    const broken = fakeClient(() => {
      throw new Error('500');
    });
    expect((await wordQuestion(provider(broken.client), question)).fallbackReason).toBe(
      'PROVIDER_ERROR',
    );
  });

  it('stops calling the provider once the token budget is spent', async () => {
    let now = 0;
    // 4,100 tokens: enough for one call (4,000 reserved), not for a second after 160 are spent.
    const budget = new TokenBudget(4_100, 60_000, () => now);
    const { client, calls } = fakeClient(
      reply({ text: question.text, alternatives: question.alternatives }),
    );
    const p = provider(client, 'claude-opus-5-5', budget);
    await wordQuestion(p, question);
    expect((await wordQuestion(p, question)).fallbackReason).toBe('BUDGET_EXHAUSTED');
    expect(calls).toHaveLength(1);
    now = 61_000;
    expect((await wordQuestion(p, question)).source).toBe('LLM');
  });

  it('is disabled by default and requires a key when enabled', async () => {
    const config = readLlmConfig({});
    expect(config.LLM_PROVIDER).toBe('disabled');
    expect(createProvider(config)).toBeInstanceOf(DisabledProvider);
    expect((await wordQuestion(new DisabledProvider(), question)).fallbackReason).toBe('DISABLED');
    expect(() => readLlmConfig({ LLM_PROVIDER: 'anthropic' })).toThrow(/LLM_API_KEY/);
    expect(
      createProvider(readLlmConfig({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test' })).model,
    ).toBe('claude-opus-5-5');
  });
});

describe('mandate summary', () => {
  const result = buildMandate({
    owner: '0x1111111111111111111111111111111111111111',
    operator: '0x2222222222222222222222222222222222222222',
    asset: '0x3333333333333333333333333333333333333333',
    vaultAddresses: {
      LIQUID: '0x4444444444444444444444444444444444444444',
      TIMED: '0x5555555555555555555555555555555555555555',
    },
    amount: 300_000_000n,
    state: applyAnswer(initialState(), 'max_lockup_seconds', 'no_lockup'),
    nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
  });
  if (!result.ok) throw new Error('fixture');

  it('falls back to a deterministic summary built from preview facts', async () => {
    const summary = await summarizeMandate(new DisabledProvider(), result.preview);
    expect(summary.source).toBe('TEMPLATE');
    expect(summary.value).toMatch(/300 MockUSDC once into LiquidVault/);
  });

  it('rejects a model summary that invents numbers or vaults', async () => {
    const bad = fakeClient(reply({ summary: 'The agent earns 12% in AaveVault.' }));
    expect((await summarizeMandate(provider(bad.client), result.preview)).source).toBe('TEMPLATE');
    const good = fakeClient(
      reply({
        summary: 'The agent can deposit 300 MockUSDC once into LiquidVault and withdraw it to you.',
      }),
    );
    expect((await summarizeMandate(provider(good.client), result.preview)).source).toBe('LLM');
  });
});
