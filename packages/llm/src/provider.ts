import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LlmFailure =
  'DISABLED' | 'BUDGET_EXHAUSTED' | 'TIMEOUT' | 'REFUSAL' | 'INVALID_OUTPUT' | 'PROVIDER_ERROR';

export type LlmResult<T> =
  | { ok: true; value: T; usage: LlmUsage; model: string; latencyMs: number }
  | { ok: false; reason: LlmFailure; usage: LlmUsage; latencyMs: number };

export interface LlmRequest<T> {
  /** Short label for accounting and logs; never contains user data. */
  purpose: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

/** Wording/summarizing only: callers validate every result and keep a deterministic fallback. */
export interface LlmProvider {
  readonly name: 'disabled' | 'anthropic' | 'openai';
  readonly model: string | null;
  generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

export class DisabledProvider implements LlmProvider {
  readonly name = 'disabled' as const;
  readonly model = null;
  async generate<T>(): Promise<LlmResult<T>> {
    return { ok: false, reason: 'DISABLED', usage: NO_USAGE, latencyMs: 0 };
  }
}

/** Rolling token budget per process; an exhausted budget falls back instead of spending more. */
export class TokenBudget {
  private entries: { at: number; tokens: number }[] = [];

  constructor(
    private readonly maxTokens: number,
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  private prune() {
    const cutoff = this.now() - this.windowMs;
    this.entries = this.entries.filter((entry) => entry.at > cutoff);
  }

  remaining(): number {
    this.prune();
    return this.maxTokens - this.entries.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  record(tokens: number) {
    this.entries.push({ at: this.now(), tokens });
  }
}

/** The subset of the SDK client used here, so tests can inject a fake. */
export interface MessagesClient {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } };
}

export interface AnthropicProviderOptions {
  client: MessagesClient;
  model: string;
  /** Whole-call deadline including retries (PRD §10.4: 20 s for clarification). */
  deadlineMs: number;
  maxOutputTokens: number;
  budget: TokenBudget;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly options: AnthropicProviderOptions) {}

  get model() {
    return this.options.model;
  }

  async generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    if (this.options.budget.remaining() < this.options.maxOutputTokens)
      return { ok: false, reason: 'BUDGET_EXHAUSTED', usage: NO_USAGE, latencyMs: 0 };
    // Server-side refusal fallback is opt-in per request; Haiku models do not support it.
    const fallback = this.options.model.startsWith('claude-haiku')
      ? {}
      : { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const };
    try {
      const response = await this.options.client.beta.messages.parse(
        {
          model: this.options.model,
          max_tokens: this.options.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: { effort: 'low', format: betaZodOutputFormat(request.schema) },
          ...fallback,
        },
        {
          // Up to 3 attempts in total (PRD §13.1), all inside the stage deadline.
          maxRetries: 2,
          timeout: Math.max(Math.floor(this.options.deadlineMs / 2), 1_000),
          signal: AbortSignal.timeout(this.options.deadlineMs),
        },
      );
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      this.options.budget.record(usage.inputTokens + usage.outputTokens);
      if (response.stop_reason === 'refusal')
        return { ok: false, reason: 'REFUSAL', usage, latencyMs: elapsed() };
      const parsed = request.schema.safeParse(response.parsed_output);
      if (response.stop_reason !== 'end_turn' || !parsed.success)
        return { ok: false, reason: 'INVALID_OUTPUT', usage, latencyMs: elapsed() };
      return { ok: true, value: parsed.data, usage, model: response.model, latencyMs: elapsed() };
    } catch (error) {
      const timedOut =
        error instanceof Anthropic.APIConnectionTimeoutError ||
        (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      return {
        ok: false,
        reason: timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR',
        usage: NO_USAGE,
        latencyMs: elapsed(),
      };
    }
  }
}

/** The subset of the OpenAI client used here, so tests can inject a fake. */
export interface ChatCompletionsClient {
  chat: { completions: { create: OpenAI['chat']['completions']['create'] } };
}

export interface OpenAiProviderOptions {
  client: ChatCompletionsClient;
  model: string;
  /** Whole-call deadline including retries (PRD §10.4: 20 s for clarification). */
  deadlineMs: number;
  maxOutputTokens: number;
  budget: TokenBudget;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Same contract as AnthropicProvider, through OpenAI chat completions with strict structured output. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;

  constructor(private readonly options: OpenAiProviderOptions) {}

  get model() {
    return this.options.model;
  }

  async generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    if (this.options.budget.remaining() < this.options.maxOutputTokens)
      return { ok: false, reason: 'BUDGET_EXHAUSTED', usage: NO_USAGE, latencyMs: 0 };
    // Reasoning models (o-series, GPT-5) accept an effort; keep it low like the Anthropic provider.
    // Other models reject the parameter.
    const reasoning = /^(o\d|gpt-5)/.test(this.options.model)
      ? { reasoning_effort: 'low' as const }
      : {};
    try {
      const response = await this.options.client.chat.completions.create(
        {
          model: this.options.model,
          max_completion_tokens: this.options.maxOutputTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          response_format: zodResponseFormat(request.schema, 'output'),
          ...reasoning,
        },
        {
          // Up to 3 attempts in total (PRD §13.1), all inside the stage deadline.
          maxRetries: 2,
          timeout: Math.max(Math.floor(this.options.deadlineMs / 2), 1_000),
          signal: AbortSignal.timeout(this.options.deadlineMs),
        },
      );
      const usage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
      this.options.budget.record(usage.inputTokens + usage.outputTokens);
      const choice = response.choices[0];
      if (choice?.message.refusal || choice?.finish_reason === 'content_filter')
        return { ok: false, reason: 'REFUSAL', usage, latencyMs: elapsed() };
      const parsed = request.schema.safeParse(parseJson(choice?.message.content ?? ''));
      if (choice?.finish_reason !== 'stop' || !parsed.success)
        return { ok: false, reason: 'INVALID_OUTPUT', usage, latencyMs: elapsed() };
      return { ok: true, value: parsed.data, usage, model: response.model, latencyMs: elapsed() };
    } catch (error) {
      const timedOut =
        error instanceof OpenAI.APIConnectionTimeoutError ||
        (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      return {
        ok: false,
        reason: timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR',
        usage: NO_USAGE,
        latencyMs: elapsed(),
      };
    }
  }
}
