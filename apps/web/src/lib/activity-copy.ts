import { formatMockUsdc } from './amount';
import type { ActivityItem } from './dashboard';

export type Tone = 'neutral' | 'good' | 'warn';

export interface Described {
  title: string;
  detail?: string;
  /** Lime ("good") only for what verifiably happened on chain; never for HOLD or a rejection. */
  tone: Tone;
}

const VAULT_NAMES: Record<string, string> = { LIQUID: 'LiquidVault', TIMED: 'TimedVault' };

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
const amountOf = (payload: Record<string, unknown>) => {
  const amount = str(payload.amount);
  return amount && /^\d+$/.test(amount) ? formatMockUsdc(amount) : undefined;
};
const actionWord = (payload: Record<string, unknown>) =>
  str(payload.kind) === 'WITHDRAW' ? 'withdrawal' : 'deposit';
const reasonOf = (payload: Record<string, unknown>) =>
  str(payload.reason) ?? (str(payload.reasonCode) ? `Code ${str(payload.reasonCode)}` : undefined);

/** One timeline entry in the owner's words. Unknown types are shown as-is rather than hidden. */
export function describeActivity(item: ActivityItem): Described {
  const p = item.payload ?? {};
  const amount = amountOf(p);
  switch (item.type) {
    case 'INTENT_CREATED':
      return { title: 'Goal created', detail: amount, tone: 'neutral' };
    case 'QUESTION_ANSWERED':
      return {
        title: 'Answered a clarifying question',
        detail:
          str(p.status) === 'UNKNOWN' ? 'Not sure · the more cautious limit applies' : undefined,
        tone: 'neutral',
      };
    case 'INTENT_ESCALATED':
      return { title: 'Nothing could be delegated', detail: reasonOf(p), tone: 'warn' };
    case 'MANDATE_PREVIEWED':
      return { title: `Mandate drafted (revision ${p.revision ?? '?'})`, tone: 'neutral' };
    case 'MANDATE_APPROVED':
      return {
        title: `Mandate approved (revision ${p.revision ?? '?'})`,
        detail: 'Not active until it is verified on chain.',
        tone: 'neutral',
      };
    case 'AUTHORIZATION_CHECK_REQUESTED':
      return { title: 'Asked Boundra to verify the mandate on chain', tone: 'neutral' };
    case 'MANDATE_AUTHORIZED':
      return {
        title: 'Mandate verified on chain',
        detail: 'The agent may act within it.',
        tone: 'good',
      };
    case 'EXECUTOR_FUNDED':
      return { title: 'Executor funded', detail: amountOf({ amount: p.idle }), tone: 'neutral' };
    case 'DECISION_HOLD':
      return { title: 'Agent held · no transaction', detail: reasonOf(p), tone: 'neutral' };
    case 'DECISION_ESCALATE':
      return { title: 'Agent needs you · no transaction', detail: reasonOf(p), tone: 'warn' };
    case 'ACTION_PROPOSED':
      return { title: `Agent proposed a ${actionWord(p)}`, detail: amount, tone: 'neutral' };
    case 'ACTION_REJECTED':
      return {
        title: `${actionWord(p) === 'deposit' ? 'Deposit' : 'Withdrawal'} stopped before broadcast`,
        detail: reasonOf(p),
        tone: 'warn',
      };
    case 'ACTION_BROADCAST':
      return {
        title: `${actionWord(p) === 'deposit' ? 'Deposit' : 'Withdrawal'} sent · not yet confirmed`,
        detail: amount,
        tone: 'neutral',
      };
    case 'ACTION_RECONCILE':
      return { title: 'Checking an action’s result on chain', detail: amount, tone: 'neutral' };
    case 'ACTION_CONFIRMED':
      return {
        title: `${actionWord(p) === 'deposit' ? 'Deposit' : 'Withdrawal'} confirmed`,
        detail: amount,
        tone: 'good',
      };
    case 'ACTION_FAILED':
      return { title: 'Action failed · nothing changed', detail: reasonOf(p), tone: 'warn' };
    case 'RISK_EVENT_OBSERVED':
      return {
        title: `Risk warning on ${VAULT_NAMES[str(p.vault) ?? ''] ?? 'a vault'}: ${str(p.riskLevel) === 'DEGRADED' ? 'degraded' : 'normal'}`,
        detail: str(p.note),
        tone: str(p.riskLevel) === 'DEGRADED' ? 'warn' : 'neutral',
      };
    case 'MANDATE_REVOKED':
      return { title: 'Mandate revoked', detail: reasonOf(p), tone: 'warn' };
    case 'MANDATE_EXPIRED':
      return { title: 'Mandate expired', detail: reasonOf(p), tone: 'neutral' };
    case 'MANDATE_PAUSED':
      return { title: 'Mandate paused', detail: reasonOf(p), tone: 'neutral' };
    case 'MANDATE_SUPERSEDED':
      return { title: 'Mandate replaced by a newer one', tone: 'neutral' };
    case 'DEMO_RESET':
      return { title: 'Demo data reset by an admin', tone: 'neutral' };
    default:
      return { title: item.type.replaceAll('_', ' ').toLowerCase(), tone: 'neutral' };
  }
}
