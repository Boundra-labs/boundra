import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatUnits, getAddress, type Address } from 'viem';
import { z } from 'zod';
import {
  BoundraApiError,
  BoundraOperatorError,
  isEscalation,
  mockUsdc,
  ownerActionCall,
  type BoundraClient,
  type BoundraOperator,
  type MandateView,
  type OwnerAction,
  type PublicConfig,
} from '@boundra/sdk';

export const SERVER_INFO = { name: 'boundra', version: '0.1.0' } as const;

/** What the server can do depends on what it was given; it never has an owner's key. */
export interface ServerDeps {
  /** Owner tools: an API client holding the owner's API token. */
  owner?: Pick<
    BoundraClient,
    | 'dashboard'
    | 'activity'
    | 'getMandate'
    | 'startGoal'
    | 'answer'
    | 'getIntent'
    | 'draftMandate'
    | 'reviseMandate'
  >;
  /** Reviewed contracts, for owner actions that name a vault. */
  publicConfig?: () => Promise<PublicConfig>;
  /** Operator tools: the agent's own key, bounded by each owner's mandate. */
  operator?: Pick<BoundraOperator, 'address' | 'status' | 'deposit' | 'withdraw'>;
  /** The Boundra app, for links the owner opens to review and sign. */
  appUrl?: string;
}

const TESTNET = 'Base Sepolia testnet: MockUSDC and mock vaults, no real funds.';
const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .describe('MockUSDC amount as a decimal string, e.g. "300" or "12.5"');
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const vaultSchema = z.enum(['LIQUID', 'TIMED']);

const display = (baseUnits: string | bigint) => `${formatUnits(BigInt(baseUnits), 6)} MockUSDC`;
const json = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

function result(summary: string, data?: unknown): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }];
  if (data !== undefined) content.push({ type: 'text', text: json(data) });
  return { content };
}

function failure(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** API and chain refusals become tool errors the assistant can explain; others propagate. */
async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BoundraApiError)
      return failure(
        `${error.code}: ${error.message}${error.recovery ? ` ${error.recovery}` : ''}`,
      );
    if (error instanceof BoundraOperatorError)
      return failure(
        `${error.code}: ${error.message}${error.txHash ? ` Transaction ${error.txHash}.` : ''}`,
      );
    throw error;
  }
}

function mandateSummary(view: MandateView, appUrl?: string) {
  const p = view.preview;
  const agent =
    p.operatorSource === 'OWNER'
      ? `the owner's own agent ${p.operator} (Boundra does not run it)`
      : `Boundra's agent ${p.operator}`;
  const lines = [
    `Mandate ${view.id}, revision ${view.revision}, status ${view.status}.`,
    `Agent: ${agent}. Vault: ${p.target.name}. Amount: ${display(p.limits.allocationTarget ?? '0')}.`,
    `Per deposit ≤ ${display(p.limits.maxDepositPerAction ?? '0')}, per withdrawal ≤ ${display(p.limits.maxWithdrawPerAction ?? '0')}, expires ${new Date(Number(p.expiresAt) * 1000).toISOString()}.`,
    ...p.notices.map((notice) => `Notice: ${notice}`),
  ];
  if (view.status === 'PREVIEWED' && appUrl)
    lines.push(
      `Only the owner can approve it: they review and approve it in the app at ${appUrl}/app/mandates/${view.id}, then sign the transactions in their own wallet.`,
    );
  return lines.join('\n');
}

const noOwner = () =>
  failure(
    'No owner API token is configured. The owner creates one in the Boundra app ("Connect an app or AI assistant") and sets BOUNDRA_API_TOKEN for this server.',
  );

/** Builds the Boundra MCP server. Tools exist only for the capabilities it was given. */
export function createBoundraServer(deps: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: `Boundra lets an owner delegate MockUSDC to an agent within a mandate their executor contract enforces. ${TESTNET} Never claim to approve a mandate or sign for the owner: owner approvals and owner transactions always happen in the owner's own app and wallet. Amounts are MockUSDC decimal strings.`,
  });
  const { owner, operator, appUrl } = deps;

  if (owner) {
    server.registerTool(
      'boundra_get_overview',
      {
        title: 'Agent overview',
        description: `The owner's executor, current mandate, idle funds, vault positions and risk status, from confirmed chain data. ${TESTNET}`,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      () =>
        guarded(async () => {
          const d = await owner.dashboard();
          const lines = [`Owner ${d.owner}. Executor: ${d.executor ?? 'not registered'}.`];
          if (d.mandate)
            lines.push(
              `Mandate ${d.mandate.id}: ${d.mandate.status}, ${d.mandate.selectedVault} vault, operator ${d.mandate.tuple.operator}.`,
            );
          else lines.push('No mandate yet.');
          lines.push(`Chain data: ${d.chainStatus}.`);
          return result(lines.join('\n'), d);
        }),
    );

    server.registerTool(
      'boundra_list_activity',
      {
        title: 'Activity',
        description:
          'The owner’s activity timeline, newest first. Transaction links appear only for real transactions; HOLD and refusals have none.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          before: z.string().regex(/^\d+$/).optional().describe('Page cursor (nextBefore)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      ({ limit, before }) =>
        guarded(async () => {
          const page = await owner.activity({ limit: limit ?? 20, before });
          const lines = page.items.map(
            (item) =>
              `${item.createdAt} ${item.type}${item.explorerUrl ? ` ${item.explorerUrl}` : ''}`,
          );
          return result(lines.join('\n') || 'No activity yet.', page);
        }),
    );

    server.registerTool(
      'boundra_get_mandate',
      {
        title: 'Mandate',
        description:
          'The exact limits of a mandate and the notices the owner sees. Defaults to the current mandate.',
        inputSchema: { mandateId: z.uuid().optional() },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      ({ mandateId }) =>
        guarded(async () => {
          const id = mandateId ?? (await owner.dashboard()).mandate?.id;
          if (!id) return result('The owner has no mandate yet.');
          const view = await owner.getMandate(id);
          return result(mandateSummary(view, appUrl), view);
        }),
    );

    server.registerTool(
      'boundra_start_goal',
      {
        title: 'Start a goal',
        description: `Starts a goal such as "Manage 300 MockUSDC safely" and returns the first clarifying question. Ask the owner each question; do not answer for them. ${TESTNET}`,
        inputSchema: { objective: z.string().min(3).max(500), amount: amountSchema },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      ({ objective, amount }) =>
        guarded(async () => {
          const intent = await owner.startGoal({ objective, amount: mockUsdc(amount) });
          return result(questionText(intent), intent);
        }),
    );

    server.registerTool(
      'boundra_answer_question',
      {
        title: 'Answer a question',
        description:
          'Records the owner’s answer to the active clarifying question. "unsure" is always allowed and applies the most cautious limit.',
        inputSchema: {
          intentId: z.uuid(),
          questionId: z.string().min(1).max(200),
          alternativeId: z.string().min(1).max(100),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      ({ intentId, questionId, alternativeId }) =>
        guarded(async () => {
          const intent = await owner.answer(intentId, questionId, alternativeId);
          return result(questionText(intent), intent);
        }),
    );

    server.registerTool(
      'boundra_draft_mandate',
      {
        title: 'Draft a mandate',
        description:
          'Drafts a mandate once clarification is done, or revises a draft (a new revision). Optionally names the owner’s own agent as operator. It does not approve: the owner reviews and approves it in the app, then signs in their wallet.',
        inputSchema: {
          intentId: z.uuid().optional().describe('Draft for this clarified goal'),
          mandateId: z.uuid().optional().describe('Or revise this draft'),
          operator: addressSchema.optional().describe('The owner’s own agent; omit for Boundra’s'),
          expiryDays: z.number().int().min(1).max(60).optional(),
          maxDepositPerAction: amountSchema.optional(),
          maxWithdrawPerAction: amountSchema.optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      (input) =>
        guarded(async () => {
          if (Boolean(input.intentId) === Boolean(input.mandateId))
            return failure('Give exactly one of intentId (new draft) or mandateId (revision).');
          const options = {
            operator: input.operator,
            expiryDays: input.expiryDays,
            maxDepositPerAction: input.maxDepositPerAction
              ? mockUsdc(input.maxDepositPerAction)
              : undefined,
            maxWithdrawPerAction: input.maxWithdrawPerAction
              ? mockUsdc(input.maxWithdrawPerAction)
              : undefined,
          };
          const view = input.intentId
            ? await owner.draftMandate(input.intentId, options)
            : await owner.reviseMandate(input.mandateId!, options);
          if (isEscalation(view))
            return result(
              `Nothing fits the owner's answers, so nothing is delegated: ${view.reason}`,
              view,
            );
          return result(mandateSummary(view, appUrl), view);
        }),
    );

    server.registerTool(
      'boundra_prepare_owner_action',
      {
        title: 'Prepare an owner action',
        description:
          'Prepares, but never signs, an owner control on their executor: pause, resume, revoke, recoverIdle or ownerWithdraw. Returns the unsigned transaction for the owner’s own wallet.',
        inputSchema: {
          action: z.enum(['pause', 'resume', 'revoke', 'recoverIdle', 'ownerWithdraw']),
          amount: amountSchema.optional().describe('For recoverIdle and ownerWithdraw'),
          vault: vaultSchema.optional().describe('For ownerWithdraw'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      ({ action, amount, vault }) =>
        guarded(async () => {
          const { executor } = await owner.dashboard();
          if (!executor) return failure('The owner has no registered executor yet.');
          let request: OwnerAction;
          if (action === 'recoverIdle' || action === 'ownerWithdraw') {
            if (!amount) return failure(`${action} needs an amount.`);
            if (action === 'recoverIdle') request = { kind: action, amount: mockUsdc(amount) };
            else {
              if (!vault || !deps.publicConfig) return failure('ownerWithdraw needs a vault.');
              const contracts = (await deps.publicConfig()).contracts;
              if (!contracts) return failure('The deployment is not configured.');
              request = {
                kind: action,
                vault: vault === 'LIQUID' ? contracts.liquidVault : contracts.timedVault,
                amount: mockUsdc(amount),
              };
            }
          } else request = { kind: action };
          const call = ownerActionCall(getAddress(executor) as Address, request);
          return result(
            `Prepared, not signed: ${call.description} The owner sends it from their own wallet${appUrl ? `, or uses the controls at ${appUrl}/app` : ''}.`,
            { ...call, chainId: 84532, signedBy: 'the owner, in their own wallet' },
          );
        }),
    );
  } else {
    server.registerTool(
      'boundra_get_overview',
      {
        title: 'Agent overview',
        description: 'Needs an owner API token (BOUNDRA_API_TOKEN).',
        annotations: { readOnlyHint: true },
      },
      () => noOwner(),
    );
  }

  if (operator) {
    server.registerTool(
      'boundra_operator_status',
      {
        title: 'Operator status',
        description: `What an owner's mandate lets this agent (${operator.address}) do right now: per vault, the largest deposit and withdrawal and why not. ${TESTNET}`,
        inputSchema: { owner: addressSchema },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      ({ owner: ownerAddress }) =>
        guarded(async () => {
          const s = await operator.status(getAddress(ownerAddress));
          const lines = [
            s.isOperator
              ? `This agent is the operator. Mandate ${s.active ? 'active' : 'not active'}${s.paused ? ' (paused)' : ''}${s.revoked ? ' (revoked)' : ''}.`
              : `This agent is not the operator; the mandate names ${s.mandateOperator}.`,
            `Idle in the executor: ${display(s.idle)}.`,
            ...s.vaults.map(
              (v) =>
                `${v.key}: principal ${display(v.principal)}; deposit up to ${display(v.deposit.max)}${v.deposit.refusal ? ` (${v.deposit.refusal})` : ''}; withdraw up to ${display(v.withdraw.max)}${v.withdraw.refusal ? ` (${v.withdraw.refusal})` : ''}.`,
            ),
          ];
          return result(lines.join('\n'), s);
        }),
    );

    for (const kind of ['deposit', 'withdraw'] as const)
      server.registerTool(
        `boundra_${kind}`,
        {
          title: kind === 'deposit' ? 'Deposit' : 'Withdraw',
          description:
            kind === 'deposit'
              ? 'Deposits idle MockUSDC from the owner’s executor into a vault, as this agent. Checked against the mandate and simulated first; the executor contract refuses anything outside the mandate.'
              : 'Withdraws from a vault, as this agent. The executor always pays the owner; the agent cannot change the recipient.',
          inputSchema: { owner: addressSchema, vault: vaultSchema, amount: amountSchema },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        },
        ({ owner: ownerAddress, vault, amount }) =>
          guarded(async () => {
            const done = await operator[kind]({
              owner: getAddress(ownerAddress),
              vault,
              amount: mockUsdc(amount),
            });
            return result(
              `${kind === 'deposit' ? 'Deposited' : 'Withdrew'} ${display(done.amount)} (${vault}). Transaction ${done.txHash}, block ${done.blockNumber}.`,
              done,
            );
          }),
      );
  }

  return server;
}

function questionText(intent: Awaited<ReturnType<BoundraClient['getIntent']>>) {
  if (intent.question)
    return [
      `Intent ${intent.id}. Ask the owner: ${intent.question.text}`,
      `questionId: ${intent.question.questionId}`,
      ...intent.question.alternatives.map((a) => `- ${a.id}: ${a.label}`),
    ].join('\n');
  if (intent.state === 'MANDATE_PENDING')
    return `Intent ${intent.id}: clarification is done. Draft the mandate with boundra_draft_mandate.`;
  return `Intent ${intent.id}: ${intent.state}.${intent.selection ? ` ${intent.selection.reason}` : ''}`;
}
