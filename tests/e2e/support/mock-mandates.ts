import type { Page, Route } from '@playwright/test';
import { keccak256, stringToHex, type Address } from 'viem';
import { e2eChain, executorHolds, hashWireMandate } from './chain';

type Vault = 'LIQUID' | 'TIMED';
const DAY = 86_400;
const VAULTS = {
  LIQUID: { name: 'LiquidVault', lockup: 0, yieldBps: 300, mask: 1 },
  TIMED: { name: 'TimedVault', lockup: 30 * DAY, yieldBps: 600, mask: 2 },
} as const;

interface Draft {
  id: string;
  intentId: string;
  revision: number;
  status: 'PREVIEWED' | 'APPROVED' | 'AUTHORIZED' | 'SUPERSEDED';
  vault: Vault;
  amount: bigint;
  expiresAt: number;
  maxDepositPerAction: bigint;
  maxWithdrawPerAction: bigint;
}

const fail = (route: Route, status: number, code: string, message: string, recovery?: string) =>
  route.fulfill({ status, json: { error: { code, message, recovery } } });

/**
 * A stand-in for the API's mandate drafts that keeps its rules: every edit is a new revision with
 * a new ID that supersedes the old one, omitted limits fall back to defaults, expiry and caps are
 * bounded like ACCE's buildMandate, and approval needs the exact preview hash.
 */
export async function mockMandates(
  page: Page,
  {
    owner,
    executor,
    vault = 'LIQUID',
    amount = 300_000_000n,
    agent,
  }: {
    owner: Address;
    executor: Address;
    vault?: Vault;
    amount?: bigint;
    /** The owner's own agent as operator, instead of Boundra's. */
    agent?: Address;
  },
) {
  const { manifest, operator: boundraOperator } = e2eChain();
  const operator = agent ?? boundraOperator;
  const drafts = new Map<string, Draft>();
  let escalate = false;
  let stale = false;
  let tamperHash = false;

  const view = (d: Draft) => {
    const v = VAULTS[d.vault];
    const notices = [
      'Testnet only: MockUSDC and mock vaults on Base Sepolia. No real funds and no promised returns.',
      'Withdrawals by the agent are paid directly to your wallet; the agent cannot change the recipient.',
    ];
    if (d.maxDepositPerAction < d.amount)
      notices.push(
        `The per-action cap is below the requested amount: the agent makes one deposit of ${d.maxDepositPerAction / 1_000_000n} MockUSDC and the rest stays idle in your executor.`,
      );
    if (v.lockup)
      notices.push(
        `${v.name} locks deposits for 30 days with no early exit, even if a risk warning appears.`,
      );
    if (agent)
      notices.unshift(
        'You chose the agent for this mandate yourself. Boundra does not run it or vouch for it; your executor contract still enforces every limit here, and you can pause or revoke it at any time.',
      );
    const preview = {
      version: 'preview-v1',
      descriptorVersion: 'v1',
      labels: ['TESTNET', 'MockUSDC', 'Mock vault', 'Illustrative yield only'],
      network: { chainId: 84532, name: 'Base Sepolia (testnet)' },
      owner: owner.toLowerCase(),
      operator: operator.toLowerCase(),
      ...(agent ? { operatorSource: 'OWNER' as const } : {}),
      executor: executor.toLowerCase(),
      beneficiary: owner.toLowerCase(),
      token: { address: manifest.mockUsdc.toLowerCase(), symbol: 'MockUSDC', decimals: 6 },
      amount: { baseUnits: d.amount.toString(), display: `${d.amount / 1_000_000n} MockUSDC` },
      target: {
        vault: d.vault,
        name: v.name,
        address: (d.vault === 'TIMED' ? manifest.timedVault : manifest.liquidVault).toLowerCase(),
        lockupSeconds: String(v.lockup),
        illustrativeYieldBps: v.yieldBps,
      },
      allowedActions: ['DEPOSIT', 'WITHDRAW'],
      limits: {
        maxDepositPerAction: d.maxDepositPerAction.toString(),
        maxCumulativeDeposits: d.amount.toString(),
        allocationTarget: d.amount.toString(),
        maxWithdrawPerAction: d.maxWithdrawPerAction.toString(),
        maxLockupSeconds: String(v.lockup),
      },
      expiresAt: String(d.expiresAt),
      expiresAtIso: new Date(d.expiresAt * 1000).toISOString(),
      selection: {
        reasonCode: d.vault === 'TIMED' ? 'LOCKUP_ACCEPTED_FOR_YIELD' : 'LIQUIDITY_PRESERVED',
        reason:
          d.vault === 'TIMED'
            ? 'You accepted a 30-day lockup, so the higher illustrative yield vault is selected.'
            : 'LiquidVault keeps funds withdrawable at any time and meets every limit you set.',
      },
      candidates: [],
      preferences: [
        {
          dimension: 'max_lockup_seconds',
          source: d.vault === 'TIMED' ? 'ANSWERED' : 'DEFAULT',
          answer: d.vault === 'TIMED' ? 'up_to_30_days' : null,
          enforcement:
            'On-chain: the mandate maxLockupSeconds makes the executor reject deposits into vaults with a longer lockup.',
        },
      ],
      narrowed: [],
      notices,
      plainSummary: {
        text: `The agent may deposit into ${v.name} and withdraw back to your wallet.`,
        source: 'TEMPLATE',
      },
    };
    return {
      id: d.id,
      intentId: d.intentId,
      revision: d.revision,
      status: d.status,
      executor: executor.toLowerCase(),
      tuple: tupleOf(d),
      preview,
      previewHash: keccak256(stringToHex(JSON.stringify(preview))),
      mandateHash:
        d.status === 'APPROVED' || d.status === 'AUTHORIZED'
          ? tamperHash
            ? keccak256(stringToHex('not the approved mandate'))
            : hashWireMandate(tupleOf(d))
          : null,
      approvedAt: d.status === 'PREVIEWED' ? null : new Date().toISOString(),
      authorizedAt: d.status === 'AUTHORIZED' ? new Date().toISOString() : null,
      onchainVersion: d.status === 'AUTHORIZED' ? '1' : null,
      authorizationTxHash: null,
      fundedAtBlock: null,
      escalationReason: null,
    };
  };

  const tupleOf = (d: Draft) => {
    const v = VAULTS[d.vault];
    return {
      chainId: 84532 as const,
      asset: manifest.mockUsdc.toLowerCase(),
      operator: operator.toLowerCase(),
      beneficiary: owner.toLowerCase(),
      expiresAt: String(d.expiresAt),
      allowedVaults: v.mask,
      allowedActions: 3,
      maxLockupSeconds: String(v.lockup),
      maxDepositPerAction: d.maxDepositPerAction.toString(),
      maxCumulativeDeposits: d.amount.toString(),
      maxWithdrawPerAction: d.maxWithdrawPerAction.toString(),
      allocationTarget: d.amount.toString(),
    };
  };

  /** Builds a revision like buildMandate; returns an error code for out-of-bounds limits. */
  const build = (
    intentId: string,
    body: { expiryDays?: number; maxDepositPerAction?: string; maxWithdrawPerAction?: string },
  ): Draft | string => {
    const lockupDays = VAULTS[vault].lockup / DAY;
    const days = body.expiryDays ?? (lockupDays ? lockupDays + 2 : 7);
    if (days < (lockupDays ? lockupDays + 2 : 1)) return 'EXPIRY_TOO_SHORT';
    if (days > 60) return 'EXPIRY_TOO_LONG';
    const deposit = BigInt(body.maxDepositPerAction ?? amount);
    const withdraw = BigInt(body.maxWithdrawPerAction ?? amount);
    if (deposit <= 0n || deposit > amount) return 'INVALID_DEPOSIT_CAP';
    if (withdraw <= 0n || withdraw > amount) return 'INVALID_WITHDRAW_CAP';
    for (const d of drafts.values())
      if (d.intentId === intentId && d.status !== 'SUPERSEDED') d.status = 'SUPERSEDED';
    const revision = [...drafts.values()].filter((d) => d.intentId === intentId).length + 1;
    const draft: Draft = {
      id: crypto.randomUUID(),
      intentId,
      revision,
      status: 'PREVIEWED',
      vault,
      amount,
      expiresAt: Math.floor(Date.now() / 1000) + days * DAY,
      maxDepositPerAction: deposit,
      maxWithdrawPerAction: withdraw,
    };
    drafts.set(draft.id, draft);
    return draft;
  };

  const create = async (route: Route, intentId: string, body: Record<string, unknown>) => {
    if (escalate)
      return route.fulfill({
        status: 201,
        json: {
          status: 'ESCALATED',
          reasonCode: 'NO_ELIGIBLE_VAULT',
          reason: 'No reviewed vault satisfies your constraints; nothing will be delegated.',
        },
      });
    const result = build(intentId, body);
    if (typeof result === 'string')
      return fail(route, 400, 'VALIDATION_FAILED', `Invalid mandate: ${result}`);
    return route.fulfill({ status: 201, json: view(result) });
  };

  await page.route('**/api/v1/intents/*/mandate-drafts', (route) => {
    const intentId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    return create(route, intentId, route.request().postDataJSON() ?? {});
  });
  await page.route('**/api/v1/mandate-drafts/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const draft = drafts.get(id);
    if (!draft) return fail(route, 404, 'NOT_FOUND', 'Mandate not found');
    if (route.request().method() === 'PATCH')
      return create(route, draft.intentId, route.request().postDataJSON() ?? {});
    return route.fulfill({ json: view(draft) });
  });
  await page.route('**/api/v1/mandate-drafts/*/approve', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const draft = drafts.get(id);
    if (!draft) return fail(route, 404, 'NOT_FOUND', 'Mandate not found');
    if (draft.status !== 'PREVIEWED')
      return fail(
        route,
        409,
        'INVALID_STATE',
        `A ${draft.status.toLowerCase()} mandate cannot be approved`,
      );
    const { previewHash } = route.request().postDataJSON() as { previewHash: string };
    if (stale || previewHash !== view(draft).previewHash) {
      stale = false;
      return fail(
        route,
        409,
        'STALE_PREVIEW',
        'The preview you approved does not match the current draft',
        'Reload the latest preview and review it again.',
      );
    }
    draft.status = 'APPROVED';
    return route.fulfill({ json: view(draft) });
  });
  // Stands in for the worker: AUTHORIZED only when the executor holds exactly this mandate.
  await page.route('**/api/v1/mandate-drafts/*/authorization-check', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const draft = drafts.get(id);
    if (!draft) return fail(route, 404, 'NOT_FOUND', 'Mandate not found');
    if (draft.status === 'APPROVED' && (await executorHolds(executor, tupleOf(draft))))
      draft.status = 'AUTHORIZED';
    return route.fulfill({ status: 202, json: { status: 'PENDING_VERIFICATION' } });
  });

  return {
    /** A draft that already exists for an intent, as if created earlier. */
    seed: (
      { status = 'PREVIEWED' }: { status?: 'PREVIEWED' | 'APPROVED' } = {},
      intentId = crypto.randomUUID(),
    ) => {
      const result = build(intentId, {});
      if (typeof result === 'string') throw new Error(result);
      result.status = status;
      return result.id;
    },
    /** The exact tuple of a draft, as the owner would sign it. */
    tuple: (id: string) => tupleOf(drafts.get(id)!),
    /** The API reports a different mandate hash than the tuple it serves. */
    tamperMandateHash: () => {
      tamperHash = true;
    },
    status: (id: string) => drafts.get(id)?.status,
    escalateNextDraft: () => {
      escalate = true;
    },
    /** The next approval loses to a preview that changed underneath it. */
    staleNextApproval: () => {
      stale = true;
    },
  };
}
