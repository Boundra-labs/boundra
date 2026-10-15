import type { PlannedQuestion } from '@boundra/acce';

export const WORDING_PROVIDER = Symbol('WORDING_PROVIDER');

export interface QuestionText {
  text: string;
  alternatives: { id: string; label: string }[];
  source: 'TEMPLATE' | 'LLM';
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
