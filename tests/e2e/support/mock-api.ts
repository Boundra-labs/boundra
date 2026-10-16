import type { Page } from '@playwright/test';

/**
 * Deterministic stand-ins for the Boundra API so browser tests run in CI without PostgreSQL or a
 * chain. Shapes follow docs/api.md and the API's intent view; the real API is exercised by the
 * API and chain test suites.
 */

export async function mockSignedIn(page: Page, address: string) {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: { address: address.toLowerCase(), csrfToken: 'test-csrf', admin: false },
    }),
  );
}

export async function mockPublicConfig(page: Page, configured = false) {
  await page.route('**/api/v1/config/public', (route) =>
    route.fulfill({
      json: {
        chainId: 84532,
        network: 'Base Sepolia (testnet)',
        explorer: 'https://sepolia.basescan.org',
        configured,
        contracts: null,
        operator: null,
      },
    }),
  );
}

const THIRTY_DAYS = '2592000';
const QUESTIONS = [
  {
    dimension: 'max_lockup_seconds',
    text: 'Would you accept not being able to withdraw these funds for 30 days in exchange for a higher illustrative yield?',
    alternatives: [
      { id: 'no_lockup', label: 'No, I need to be able to withdraw' },
      { id: 'up_to_30_days', label: 'Yes, a lockup of up to 30 days is fine' },
      { id: 'unsure', label: 'I am not sure' },
    ],
  },
  {
    dimension: 'withdrawal_latency_seconds',
    text: 'Might you need these funds back within the next 30 days?',
    alternatives: [
      { id: 'within_1_day', label: 'Yes, possibly as soon as tomorrow' },
      { id: 'not_for_30_days', label: 'No, not for at least 30 days' },
      { id: 'unsure', label: 'I am not sure' },
    ],
  },
];

/**
 * A small model of ACCE v1 for the lockup and liquidity questions: unanswered and "unsure" both
 * resolve to the conservative limit, so TimedVault is eligible only after the owner accepts the
 * lockup and says they won't need the funds within 30 days.
 */
export async function mockIntents(
  page: Page,
  options: { fundable?: bigint; escalateAfterFirstAnswer?: boolean } = {},
) {
  const fundable = options.fundable ?? 1_000_000_000n;
  const intents = new Map<string, { objective: string; amount: string; answers: string[] }>();
  let staleNextAnswer = false;

  const view = (id: string) => {
    const intent = intents.get(id)!;
    const [lockup, latency] = intent.answers;
    const lockupOk = lockup === 'up_to_30_days';
    const latencyOk = latency === 'not_for_30_days';
    const timedReasons = [
      ...(lockupOk
        ? []
        : [
            {
              code: 'LOCKUP_EXCEEDS_TOLERANCE',
              message: 'TimedVault locks funds for 30 days, above your tolerance.',
            },
          ]),
      ...(latencyOk
        ? []
        : [
            {
              code: 'LATENCY_EXCEEDS_NEED',
              message: 'TimedVault could not return funds as quickly as you may need them.',
            },
          ]),
    ];
    const escalated = options.escalateAfterFirstAnswer && intent.answers.length > 0;
    const done = escalated || intent.answers.length >= QUESTIONS.length;
    const next = done ? null : QUESTIONS[intent.answers.length]!;
    const timedEligible = timedReasons.length === 0;
    return {
      id,
      state: escalated ? 'ESCALATED' : done ? 'MANDATE_PENDING' : 'CLARIFYING',
      objective: intent.objective,
      amount: {
        baseUnits: intent.amount,
        display: `${BigInt(intent.amount) / 1_000_000n} MockUSDC`,
      },
      chainId: 84532,
      createdAt: new Date().toISOString(),
      question: next && {
        questionId: `${id}:${intent.answers.length + 1}`,
        order: intent.answers.length + 1,
        dimension: next.dimension,
        text: next.text,
        alternatives: next.alternatives,
        wordingSource: 'TEMPLATE',
      },
      answered: intent.answers.map((answerId, index) => ({
        questionId: `${id}:${index + 1}`,
        order: index + 1,
        dimension: QUESTIONS[index]!.dimension,
        text: QUESTIONS[index]!.text,
        answerId,
        status: answerId === 'unsure' ? 'UNKNOWN' : 'ANSWERED',
      })),
      questionsAsked: intent.answers.length + (next ? 1 : 0),
      selection: escalated
        ? {
            action: 'ESCALATE',
            reasonCode: 'NO_ELIGIBLE_VAULT',
            reason: 'No reviewed vault satisfies your constraints; nothing will be delegated.',
          }
        : timedEligible
          ? {
              action: 'DEPOSIT',
              vault: 'TIMED',
              reasonCode: 'LOCKUP_ACCEPTED_FOR_YIELD',
              reason:
                'You accepted a 30-day lockup, so the higher illustrative yield vault is selected.',
            }
          : {
              action: 'DEPOSIT',
              vault: 'LIQUID',
              reasonCode: 'LIQUIDITY_PRESERVED',
              reason:
                'LiquidVault keeps funds withdrawable at any time and meets every limit you set.',
            },
      candidates: [
        {
          vault: 'LIQUID',
          eligible: !escalated,
          illustrativeYieldBps: 300,
          lockupSeconds: '0',
          reasons: [{ code: 'ELIGIBLE', message: 'LiquidVault meets every limit you set.' }],
        },
        {
          vault: 'TIMED',
          eligible: timedEligible,
          illustrativeYieldBps: 600,
          lockupSeconds: THIRTY_DAYS,
          reasons: timedEligible
            ? [{ code: 'ELIGIBLE', message: 'TimedVault meets every limit you set.' }]
            : timedReasons,
        },
      ],
      narrowed: intent.answers.includes('unsure')
        ? [
            {
              dimension: QUESTIONS[intent.answers.indexOf('unsure')]!.dimension,
              reason: 'You were not sure, so the most conservative limit applies.',
            },
          ]
        : [],
      conflicts: [],
    };
  };

  await page.route('**/api/v1/intents', async (route) => {
    const body = route.request().postDataJSON() as { objective: string; amount: string };
    if (BigInt(body.amount) > fundable)
      return route.fulfill({
        status: 422,
        json: {
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: `Requested ${BigInt(body.amount) / 1_000_000n} MockUSDC exceeds your fundable balance of ${fundable / 1_000_000n} MockUSDC`,
            recovery: 'Claim MockUSDC from the faucet or lower the amount.',
          },
        },
      });
    const id = crypto.randomUUID();
    intents.set(id, { objective: body.objective, amount: body.amount, answers: [] });
    return route.fulfill({ status: 201, json: view(id) });
  });
  await page.route('**/api/v1/intents/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    return intents.has(id)
      ? route.fulfill({ json: view(id) })
      : route.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'Intent not found' } },
        });
  });
  await page.route('**/api/v1/intents/*/answers', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const { alternativeId } = route.request().postDataJSON() as { alternativeId: string };
    if (staleNextAnswer) {
      staleNextAnswer = false;
      // Someone answered in another tab first.
      intents.get(id)!.answers.push('no_lockup');
      return route.fulfill({
        status: 409,
        json: {
          error: { code: 'QUESTION_NOT_ACTIVE', message: 'That question is no longer active' },
        },
      });
    }
    intents.get(id)!.answers.push(alternativeId);
    return route.fulfill({ json: view(id) });
  });

  return {
    /** The next answer loses to one already given elsewhere (another tab). */
    answerElsewhereFirst: () => {
      staleNextAnswer = true;
    },
  };
}
