import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  AnthropicProvider,
  DisabledProvider,
  OpenAiProvider,
  TokenBudget,
  type LlmProvider,
} from './provider';

const unset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), inner.optional());

const schema = z.object({
  LLM_PROVIDER: z.enum(['disabled', 'anthropic', 'openai']).default('disabled'),
  LLM_MODEL: unset(z.string().min(1)),
  LLM_API_KEY: unset(z.string().min(1)),
  LLM_DEADLINE_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_000).default(4_000),
  LLM_MAX_TOKENS_PER_HOUR: z.coerce.number().int().min(0).default(200_000),
});
export type LlmConfig = z.infer<typeof schema>;

/** Default for the anthropic provider; openai needs LLM_MODEL set explicitly. */
export const DEFAULT_MODEL = 'claude-opus-5-5';

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid LLM configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const provider = result.data.LLM_PROVIDER;
  if (provider !== 'disabled' && !result.data.LLM_API_KEY)
    throw new Error(
      `Invalid LLM configuration: LLM_API_KEY is required for the ${provider} provider`,
    );
  if (provider === 'openai' && !result.data.LLM_MODEL)
    throw new Error('Invalid LLM configuration: LLM_MODEL is required for the openai provider');
  return result.data;
}

/** Disabled unless explicitly configured; the key is runtime-only and never logged. */
export function createProvider(config: LlmConfig): LlmProvider {
  if (config.LLM_PROVIDER === 'disabled') return new DisabledProvider();
  if (config.LLM_PROVIDER === 'openai')
    return new OpenAiProvider({
      client: new OpenAI({ apiKey: config.LLM_API_KEY }),
      model: config.LLM_MODEL!,
      deadlineMs: config.LLM_DEADLINE_MS,
      maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
      budget: new TokenBudget(config.LLM_MAX_TOKENS_PER_HOUR),
    });
  return new AnthropicProvider({
    client: new Anthropic({ apiKey: config.LLM_API_KEY }),
    model: config.LLM_MODEL ?? DEFAULT_MODEL,
    deadlineMs: config.LLM_DEADLINE_MS,
    maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
    budget: new TokenBudget(config.LLM_MAX_TOKENS_PER_HOUR),
  });
}
