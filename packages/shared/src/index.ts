import { z } from 'zod';

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const MOCK_USDC_DECIMALS = 6 as const;
export const MAX_UINT256 = (1n << 256n) - 1n;

// Wire amounts are canonical base-unit strings; never JavaScript floating point.
export const tokenAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(78)
  .pipe(z.string().refine((value) => BigInt(value) <= MAX_UINT256, 'Amount exceeds uint256'));
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const actionTypeSchema = z.enum(['DEPOSIT', 'HOLD', 'WITHDRAW', 'ESCALATE']);
export const workflowStateSchema = z.enum([
  'INTENT_RECEIVED',
  'CLARIFYING',
  'MANDATE_PENDING',
  'AUTHORIZED',
  'ACTION_PROPOSED',
  'POLICY_CHECKED',
  'BROADCAST',
  'CONFIRMED',
  'REJECTED',
  'FAILED',
  'RECONCILE',
  'ESCALATED',
]);

export const intentSchema = z
  .object({
    objective: z.string().trim().min(1).max(2000),
    amount: tokenAmountSchema.refine((value) => value !== '0', 'Amount must be positive'),
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
  })
  .strict();

export const questionSchema = z
  .object({
    questionId: z.string().min(1),
    targetDimension: z.enum([
      'max_lockup_seconds',
      'withdrawal_latency_seconds',
      'leverage',
      'amount',
      'permitted_vaults',
      'expiry',
    ]),
    text: z.string().min(1).max(1000),
    alternatives: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .min(2)
      .max(5),
    actionDisagreement: z.string().min(1),
    status: z.enum(['ANSWERED', 'UNKNOWN', 'ESCALATE']),
  })
  .strict();

const UINT64_MAX = (1n << 64n) - 1n;
const UINT32_MAX = (1n << 32n) - 1n;
const boundedInteger = (max: bigint) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .refine((value) => BigInt(value) <= max, 'Value exceeds contract bound');

/** Wire form of the executor's `Mandate` tuple; integers are canonical base-10 strings. */
export const mandateTupleSchema = z
  .object({
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    asset: addressSchema,
    operator: addressSchema,
    beneficiary: addressSchema,
    expiresAt: boundedInteger(UINT64_MAX),
    allowedVaults: z.number().int().min(1).max(3),
    allowedActions: z.number().int().min(1).max(3),
    maxLockupSeconds: boundedInteger(UINT32_MAX),
    maxDepositPerAction: tokenAmountSchema,
    maxCumulativeDeposits: tokenAmountSchema,
    maxWithdrawPerAction: tokenAmountSchema,
    allocationTarget: tokenAmountSchema,
  })
  .strict();

export const answerSchema = z
  .object({ questionId: z.string().min(1).max(100), alternativeId: z.string().min(1).max(64) })
  .strict();

/** Stable error codes returned by the API; messages are for display only. */
export const errorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CHALLENGE_INVALID',
  'SIGNATURE_INVALID',
  'WRONG_CHAIN',
  'EXECUTOR_NOT_REGISTERED',
  'INSUFFICIENT_BALANCE',
  'QUESTION_NOT_ACTIVE',
  'STALE_PREVIEW',
  'INVALID_STATE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export type MandateTuple = z.infer<typeof mandateTupleSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type Question = z.infer<typeof questionSchema>;
