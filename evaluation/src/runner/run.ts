import {
  ACCE_CONFIG_VERSION,
  buildMandate,
  DESCRIPTOR_VERSION,
  selectionKey,
  type MandatePreview,
} from '@boundra/acce';
import type { LlmProvider } from '@boundra/llm';
import type { MandateTuple } from '@boundra/shared';
import {
  acce,
  fixedQuestionnaire,
  oneShot,
  PROMPT_VERSION,
  type Elicitation,
  type Method,
} from '../baselines/methods';
import { publicView, type ActionKey, type Fixture, type Persona } from '../fixtures';
import { answer, consents, isAcceptable, violations, type Violation } from './simulator';

// Fixed public addresses for building comparable mandate tuples; nothing is sent on-chain.
const ADDRESSES = {
  owner: '0x00000000000000000000000000000000000000a1',
  operator: '0x00000000000000000000000000000000000000a2',
  asset: '0x00000000000000000000000000000000000000a3',
  vaultAddresses: {
    LIQUID: '0x00000000000000000000000000000000000000b1',
    TIMED: '0x00000000000000000000000000000000000000b2',
  },
};
// Frozen clock so expiries, previews and therefore results are reproducible.
const NOW = 1_800_000_000n;

export interface CaseResult {
  personaId: string;
  method: Method;
  generator: Elicitation['generator'];
  questions: number;
  action: ActionKey;
  /** Mandate produced before the consent step (null when the method escalated). */
  draftMismatch: boolean | null;
  draftViolations: Violation[];
  approved: boolean;
  /** Mismatch of the mandate actually approved; null when nothing was approved. */
  approvedMismatch: boolean | null;
  acceptableAction: boolean;
  falseRefusal: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  failures: string[];
}

async function elicit(
  method: Method,
  persona: Persona,
  provider: LlmProvider,
): Promise<Elicitation> {
  // The simulator closes over hidden preferences; methods only see answers.
  const ask = (dimension: Parameters<typeof answer>[1]) => answer(persona.hidden, dimension);
  if (method === 'B0' || method === 'B1') return oneShot(provider, publicView(persona));
  if (method === 'B2') return fixedQuestionnaire(ask);
  return acce(ask);
}

export async function runCase(
  method: Method,
  persona: Persona,
  provider: LlmProvider,
): Promise<CaseResult> {
  const started = performance.now();
  const elicitation = await elicit(method, persona, provider);
  const built = buildMandate({
    ...ADDRESSES,
    amount: BigInt(persona.amount),
    state: elicitation.state,
    nowSeconds: NOW,
  });
  const latencyMs = Math.round(performance.now() - started);
  const base = {
    personaId: persona.id,
    method,
    generator: elicitation.generator,
    questions: elicitation.questions,
    latencyMs,
    inputTokens: elicitation.usage.inputTokens,
    outputTokens: elicitation.usage.outputTokens,
    failures: elicitation.failures,
  };
  if (!built.ok) {
    const action: ActionKey = 'ESCALATE';
    return {
      ...base,
      action,
      draftMismatch: null,
      draftViolations: [],
      approved: false,
      approvedMismatch: null,
      acceptableAction: isAcceptable(persona, action),
      falseRefusal: !isAcceptable(persona, action),
    };
  }
  const action = selectionKey(built.selection) as ActionKey;
  const draftViolations = violations(persona, built.tuple as MandateTuple);
  // B0 has no confirmation screen (consent protocol: the draft is the mandate). B1 adds a static
  // confirmation; B2/B3 keep the same owner approval step as the product.
  const approved = method === 'B0' ? true : consents(persona, built.preview as MandatePreview);
  return {
    ...base,
    action,
    draftMismatch: draftViolations.length > 0,
    draftViolations,
    approved,
    approvedMismatch: approved ? draftViolations.length > 0 : null,
    acceptableAction: approved && isAcceptable(persona, action),
    // A safe deposit existed but no mandate was approved.
    falseRefusal:
      !approved && persona.expected.acceptableActions.some((a) => a.startsWith('DEPOSIT')),
  };
}

export interface RunOptions {
  fixture: Fixture;
  fixtureSha256: string;
  split: 'development' | 'heldout';
  methods: Method[];
  provider: LlmProvider;
}

export interface RunReport {
  generatedAt: string;
  fixtureVersion: string;
  fixtureSha256: string;
  frozen: boolean;
  split: string;
  provenance: string;
  versions: { acceConfig: string; descriptors: string; prompt: string };
  provider: { name: string; model: string | null };
  methods: Record<Method, ReturnType<typeof summarize>>;
  cases: CaseResult[];
}

const ratio = (count: number, denominator: number) => ({
  count,
  denominator,
  rate: denominator === 0 ? null : Math.round((count / denominator) * 10_000) / 10_000,
});

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Every denominator is reported; escalations and rejected drafts are never dropped (PRD §11.1). */
export function summarize(cases: CaseResult[]) {
  const drafts = cases.filter((c) => c.draftMismatch !== null);
  const approved = cases.filter((c) => c.approved);
  const questions = cases.map((c) => c.questions);
  return {
    personas: cases.length,
    draftMismatch: ratio(drafts.filter((c) => c.draftMismatch).length, drafts.length),
    approvedMismatch: ratio(approved.filter((c) => c.approvedMismatch).length, approved.length),
    completion: ratio(approved.length, cases.length),
    acceptableAction: ratio(cases.filter((c) => c.acceptableAction).length, cases.length),
    falseRefusal: ratio(cases.filter((c) => c.falseRefusal).length, cases.length),
    escalatedOrNoMandate: ratio(cases.filter((c) => !c.approved).length, cases.length),
    questions: {
      mean: questions.length ? questions.reduce((a, b) => a + b, 0) / questions.length : null,
      median: median(questions),
      max: questions.length ? Math.max(...questions) : null,
    },
    latencyMs: { median: median(cases.map((c) => c.latencyMs)) },
    tokens: {
      input: cases.reduce((sum, c) => sum + c.inputTokens, 0),
      output: cases.reduce((sum, c) => sum + c.outputTokens, 0),
    },
    generators: [...new Set(cases.map((c) => c.generator))],
    failures: cases.flatMap((c) => c.failures.map((f) => `${c.personaId}: ${f}`)),
    unauthorizedExecutions: 0,
  };
}

export async function runBenchmark(options: RunOptions): Promise<RunReport> {
  if (options.split === 'heldout' && !options.fixture.frozen)
    throw new Error('The held-out split can only run on a frozen fixture');
  const personas = options.fixture.personas.filter((p) => p.split === options.split);
  if (personas.length === 0) throw new Error(`No personas in split ${options.split}`);
  const cases: CaseResult[] = [];
  for (const method of options.methods)
    for (const persona of personas) cases.push(await runCase(method, persona, options.provider));
  const methods = Object.fromEntries(
    options.methods.map((method) => [method, summarize(cases.filter((c) => c.method === method))]),
  ) as RunReport['methods'];
  return {
    generatedAt: new Date().toISOString(),
    fixtureVersion: options.fixture.fixtureVersion,
    fixtureSha256: options.fixtureSha256,
    frozen: options.fixture.frozen,
    split: options.split,
    provenance: options.fixture.provenance,
    versions: {
      acceConfig: ACCE_CONFIG_VERSION,
      descriptors: DESCRIPTOR_VERSION,
      prompt: PROMPT_VERSION,
    },
    provider: { name: options.provider.name, model: options.provider.model },
    methods,
    cases,
  };
}
