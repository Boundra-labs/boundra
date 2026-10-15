import type { PlannedQuestion } from '@boundra/acce';
import { wordQuestion, type LlmProvider } from '@boundra/llm';

export const WORDING_PROVIDER = Symbol('WORDING_PROVIDER');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface QuestionText {
  text: string;
  alternatives: { id: string; label: string }[];
  source: 'TEMPLATE' | 'LLM';
  /** Why the template was used (provider disabled, refusal, invalid output, budget, timeout). */
  fallbackReason?: string | null;
}

/** Phrases a planned question. Ranking and alternatives are decided before this is called. */
export interface WordingProvider {
  word(question: PlannedQuestion): Promise<QuestionText>;
}

/** Deterministic fallback: the reviewed template, labelled as such. */
export class TemplateWordingProvider implements WordingProvider {
  async word(question: PlannedQuestion): Promise<QuestionText> {
    return { text: question.text, alternatives: question.alternatives, source: 'TEMPLATE' };
  }
}

/** Model wording with validation; any failure falls back to the template and says why. */
export class LlmWordingProvider implements WordingProvider {
  constructor(private readonly provider: LlmProvider) {}

  async word(question: PlannedQuestion): Promise<QuestionText> {
    const result = await wordQuestion(this.provider, question);
    return { ...result.value, source: result.source, fallbackReason: result.fallbackReason };
  }
}
