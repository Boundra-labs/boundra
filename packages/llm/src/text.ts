import { z } from 'zod';
import {
  checkGeneratedText,
  validateWording,
  type MandatePreview,
  type PlannedQuestion,
} from '@boundra/acce';
import type { LlmFailure, LlmProvider, LlmUsage } from './provider';

export interface GeneratedText<T> {
  value: T;
  source: 'TEMPLATE' | 'LLM';
  /** Why the deterministic template was used instead of model output. */
  fallbackReason: LlmFailure | string | null;
  usage: LlmUsage;
  model: string | null;
}

const wordingSchema = z
  .object({
    text: z.string(),
    alternatives: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
  })
  .strict();

const WORDING_SYSTEM = [
  'You rephrase one clarification question for a testnet wallet app in plain, friendly English.',
  'Keep the meaning exactly. Keep every alternative id and its order. Do not add numbers, vaults,',
  'protocols, addresses, links, advice or promises of returns. Stay under 300 characters.',
].join(' ');

/**
 * Model wording for a planned question. Ranking, alternatives and their meaning are fixed before
 * this runs; anything the validator rejects falls back to the reviewed template.
 */
export async function wordQuestion(
  provider: LlmProvider,
  question: PlannedQuestion,
): Promise<GeneratedText<{ text: string; alternatives: { id: string; label: string }[] }>> {
  const template = { text: question.text, alternatives: question.alternatives };
  const result = await provider.generate({
    purpose: 'acce-question-wording',
    system: WORDING_SYSTEM,
    prompt: JSON.stringify({ question: template.text, alternatives: template.alternatives }),
    schema: wordingSchema,
  });
  if (!result.ok)
    return {
      value: template,
      source: 'TEMPLATE',
      fallbackReason: result.reason,
      usage: result.usage,
      model: null,
    };
  const checked = validateWording(template, result.value);
  if (!checked.ok)
    return {
      value: template,
      source: 'TEMPLATE',
      fallbackReason: checked.reason,
      usage: result.usage,
      model: result.model,
    };
  return {
    value: checked.wording,
    source: 'LLM',
    fallbackReason: null,
    usage: result.usage,
    model: result.model,
  };
}

/** Deterministic plain-language summary built only from preview fields. */
export function templateSummary(preview: MandatePreview): string {
  const days = Math.round((Date.parse(preview.expiresAtIso) - Date.now()) / 86_400_000);
  const lockup =
    preview.target.lockupSeconds === '0' ? 'withdrawable at any time' : 'locked for 30 days';
  return `The agent may deposit ${preview.amount.display} once into ${preview.target.name} (${lockup}) and withdraw it back to your wallet if the vault reports degraded conditions. It cannot use other vaults, change the recipient or act after about ${days} days.`;
}

const summarySchema = z.object({ summary: z.string() }).strict();

/**
 * Optional model summary of a mandate preview. It may only restate preview facts; numbers and
 * vault names are checked against the preview, otherwise the deterministic summary is used.
 */
export async function summarizeMandate(
  provider: LlmProvider,
  preview: MandatePreview,
): Promise<GeneratedText<string>> {
  const fallback = templateSummary(preview);
  const facts = {
    amount: preview.amount.display,
    vault: preview.target.name,
    lockupDays: preview.target.lockupSeconds === '0' ? 0 : 30,
    expiresAt: preview.expiresAtIso,
    allowedActions: preview.allowedActions,
    notices: preview.notices,
  };
  const result = await provider.generate({
    purpose: 'mandate-summary',
    system:
      'Summarize these delegation limits for the wallet owner in two plain English sentences. Use only the given facts. No advice, no promises of returns, under 400 characters.',
    prompt: JSON.stringify(facts),
    schema: summarySchema,
  });
  if (!result.ok)
    return {
      value: fallback,
      source: 'TEMPLATE',
      fallbackReason: result.reason,
      usage: result.usage,
      model: null,
    };
  const issue = checkGeneratedText(
    `${JSON.stringify(facts)} ${fallback}`,
    result.value.summary,
    400,
  );
  if (issue)
    return {
      value: fallback,
      source: 'TEMPLATE',
      fallbackReason: issue,
      usage: result.usage,
      model: result.model,
    };
  return {
    value: result.value.summary.trim(),
    source: 'LLM',
    fallbackReason: null,
    usage: result.usage,
    model: result.model,
  };
}
