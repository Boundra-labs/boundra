export interface QuestionWording {
  text: string;
  alternatives: { id: string; label: string }[];
}

export type WordingCheck = { ok: true; wording: QuestionWording } | { ok: false; reason: string };

const NUMBER = /\d+(?:[.,]\d+)?/g;
const FORBIDDEN: [RegExp, string][] = [
  [/0x[0-9a-f]{6,}/i, 'ADDRESS_OR_HASH'],
  [/https?:\/\/|www\./i, 'URL'],
  [/\b(guarantee[ds]?|risk[- ]free|no risk|cannot lose|safe returns?)\b/i, 'GUARANTEE_CLAIM'],
  [/\b(aave|compound|uniswap|lido|curve|maker|morpho|pendle|eigen\w*)\b/i, 'UNREVIEWED_PROTOCOL'],
  [/<\/?[a-z][^>]*>/i, 'MARKUP'],
];

function numbers(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map((n) => n.replace(',', '.')));
}
const vaultNames = (text: string) => new Set(text.match(/\b[A-Z]\w*Vault\b/g) ?? []);

/** Checks free text produced by a model against the deterministic facts it was given. */
export function checkGeneratedText(facts: string, text: string, maxLength: number): string | null {
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > maxLength)
    return 'LENGTH';
  for (const [pattern, code] of FORBIDDEN) if (pattern.test(text)) return code;
  const allowedNumbers = numbers(facts);
  for (const n of numbers(text)) if (!allowedNumbers.has(n)) return 'NEW_NUMBER';
  const allowedVaults = vaultNames(facts);
  for (const name of vaultNames(text)) if (!allowedVaults.has(name)) return 'NEW_VAULT';
  return null;
}

/**
 * A model may only rephrase a template question. Alternative IDs, their order and every fact
 * (numbers, vault names) must be unchanged; any violation falls back to the template.
 */
export function validateWording(template: QuestionWording, candidate: unknown): WordingCheck {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'SHAPE' };
  const { text, alternatives } = candidate as Partial<QuestionWording>;
  if (typeof text !== 'string' || !Array.isArray(alternatives))
    return { ok: false, reason: 'SHAPE' };
  if (
    alternatives.length !== template.alternatives.length ||
    alternatives.some(
      (alt, index) =>
        !alt ||
        typeof alt !== 'object' ||
        alt.id !== template.alternatives[index]!.id ||
        typeof alt.label !== 'string',
    )
  )
    return { ok: false, reason: 'ALTERNATIVES_CHANGED' };
  const facts = [template.text, ...template.alternatives.map((alt) => alt.label)].join(' ');
  const textIssue = checkGeneratedText(facts, text, 300);
  if (textIssue) return { ok: false, reason: textIssue };
  for (const alt of alternatives) {
    const issue = checkGeneratedText(facts, alt.label, 100);
    if (issue) return { ok: false, reason: `LABEL_${issue}` };
  }
  return {
    ok: true,
    wording: {
      text: text.trim(),
      alternatives: alternatives.map((alt) => ({ id: alt.id, label: alt.label.trim() })),
    },
  };
}
