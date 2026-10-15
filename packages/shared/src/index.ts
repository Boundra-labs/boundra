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

export type Intent = z.infer<typeof intentSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type Question = z.infer<typeof questionSchema>;
