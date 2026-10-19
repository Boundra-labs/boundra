import {
  createWalletClient,
  getAddress,
  http,
  toHex,
  zeroAddress,
  type Account,
  type Address,
  type Hash,
} from 'viem';
import {
  baseSepolia,
  boundraFactoryAbi,
  BoundraChainReader,
  ChainPolicyError,
  createReadOnlyChainClient,
  prepareAction,
  type ExecutorSnapshot,
} from '@boundra/chain';

export type VaultKey = 'LIQUID' | 'TIMED';
export type ActionKind = 'DEPOSIT' | 'WITHDRAW';

/** Why an action was refused, before anything was sent or by the executor itself. */
export const REFUSALS: Record<string, string> = {
  NO_EXECUTOR: 'This owner has no Boundra executor.',
  INACTIVE_MANDATE: 'The mandate is not active: it is not set yet, paused, revoked or expired.',
  WRONG_OPERATOR: 'This agent is not the operator the owner named in the mandate.',
  INVALID_AUTHORITY: 'The mandate does not pay the owner in the executor’s token.',
  TARGET_NOT_ALLOWED: 'The mandate does not allow this vault.',
  ACTION_NOT_ALLOWED: 'The mandate does not allow this kind of action.',
  ALLOCATION_COMPLETED: 'The mandate’s one allocation has already been made.',
  VAULT_DEGRADED: 'The vault has a risk warning, so deposits into it are blocked.',
  DEPOSIT_LIMIT: 'The amount is above the per-deposit limit.',
  BUDGET_EXCEEDED: 'The amount is above what is left of the total deposit budget.',
  INSUFFICIENT_FUNDING: 'The executor does not hold that much idle MockUSDC.',
  LOCKUP_NOT_ALLOWED: 'The vault locks funds for longer than the mandate allows.',
  EXPIRY_BEFORE_UNLOCK: 'The mandate would expire before this vault unlocks.',
  WITHDRAWAL_LIMIT: 'The amount is above the per-withdrawal limit.',
  WITHDRAWAL_UNAVAILABLE: 'That much cannot be withdrawn from this vault now.',
  INVALID_DEADLINE: 'The mandate expires too soon to act.',
  STALE_OBSERVATION: 'The chain data was too old. Try again.',
  WRONG_VERSION: 'The mandate changed while the action was prepared. Try again.',
  WRONG_NONCE: 'Another action went first. Try again.',
  WRONG_CHAIN: 'The RPC is not Base Sepolia.',
  UNTRUSTED_BYTECODE: 'The contracts do not match the reviewed deployment.',
  NOTHING_TO_DO: 'The amount must be more than zero.',
  SIMULATION_REVERTED: 'The executor would reject this action.',
  REVERTED: 'The executor rejected the transaction on chain.',
};

export class BoundraOperatorError extends Error {
  constructor(
    readonly code: string,
    message = REFUSALS[code] ?? code,
    readonly txHash?: Hash,
  ) {
    super(message);
    this.name = 'BoundraOperatorError';
  }
}

export interface OperatorOptions {
  /** Base Sepolia RPC (a local anvil chain with ID 84532 works for development). */
  rpcUrl: string;
  /** The reviewed deployment manifest (deploy/manifests/base-sepolia.json). */
  manifest: unknown;
  /** The agent's own account. Never the owner's, the deployer's or the risk admin's key. */
  account: Account;
  /** Blocks behind head that reads use; 1 reads the latest block. */
  confirmations?: number;
  /** How long a submitted action stays valid, capped by the mandate's expiry. */
  deadlineSeconds?: number;
}

export interface VaultStatus {
  key: VaultKey;
  address: Address;
  allowedByMandate: boolean;
  lockupSeconds: string;
  principal: string;
  /** What a withdrawal could take now, before the per-withdrawal limit. */
  withdrawable: string;
  unlockAt: string;
  risk: 'NORMAL' | 'DEGRADED';
  /** Largest deposit the mandate allows right now, and why not when it is zero. */
  deposit: { max: string; refusal: string | null };
  /** Largest withdrawal the mandate allows right now, and why not when it is zero. */
  withdraw: { max: string; refusal: string | null };
}

export interface OperatorStatus {
  owner: Address;
  executor: Address;
  /** The operator the mandate names, and whether that is this agent. */
  mandateOperator: Address;
  isOperator: boolean;
  active: boolean;
  paused: boolean;
  revoked: boolean;
  mandateVersion: string;
  expiresAt: string;
  idle: string;
  cumulativeDeposited: string;
  allocationCompleted: boolean;
  limits: {
    maxDepositPerAction: string;
    maxCumulativeDeposits: string;
    maxWithdrawPerAction: string;
    allocationTarget: string;
    maxLockupSeconds: string;
  };
  vaults: VaultStatus[];
  blockNumber: string;
}

export interface ActionResult {
  kind: ActionKind;
  vault: VaultKey;
  amount: string;
  actionId: Hash;
  txHash: Hash;
  blockNumber: string;
}

const minimum = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

/**
 * An agent acting as a mandate's operator with its own key. Before sending anything it checks
 * the action against the confirmed mandate and simulates it; the executor contract enforces the
 * same limits on chain, so a refusal here is never the only line of defence.
 */
export class BoundraOperator {
  readonly address: Address;
  private readonly reader: BoundraChainReader;
  private readonly wallet;
  private readonly deadlineSeconds: bigint;

  constructor(private readonly options: OperatorOptions) {
    this.reader = new BoundraChainReader(
      createReadOnlyChainClient(options.rpcUrl),
      options.manifest,
      options.confirmations ?? 1,
    );
    this.address = getAddress(options.account.address);
    const forbidden = [this.reader.manifest.riskAdmin];
    if (forbidden.some((address) => getAddress(address) === this.address))
      throw new Error('The operator must not be the risk admin');
    this.wallet = createWalletClient({
      account: options.account,
      chain: baseSepolia,
      transport: http(options.rpcUrl, { timeout: 20_000 }),
    });
    this.deadlineSeconds = BigInt(options.deadlineSeconds ?? 300);
  }

  get manifest() {
    return this.reader.manifest;
  }

  /** The executor the trusted factory created for `owner`, or null. */
  async executorOf(owner: Address): Promise<Address | null> {
    const executor = await this.reader.client.readContract({
      address: getAddress(this.reader.manifest.factory),
      abi: boundraFactoryAbi,
      functionName: 'executorOf',
      args: [getAddress(owner)],
    });
    return executor === zeroAddress ? null : executor;
  }

  /** What the owner's mandate lets this agent do right now. */
  async status(owner: Address): Promise<OperatorStatus> {
    const { snapshot, nowMs } = await this.observe(owner);
    const m = snapshot.mandate;
    const now = BigInt(Math.floor(nowMs / 1000));
    const vault = (key: VaultKey): VaultStatus => {
      const v = key === 'LIQUID' ? snapshot.liquid : snapshot.timed;
      const withdrawable = now >= v.unlockAt ? minimum(v.maxWithdraw, v.principal) : 0n;
      const depositMax = snapshot.allocationCompleted
        ? 0n
        : minimum(
            m.maxDepositPerAction,
            m.maxCumulativeDeposits -
              minimum(snapshot.cumulativeDeposited, m.maxCumulativeDeposits),
            m.allocationTarget,
            snapshot.idleBalance,
          );
      const withdrawMax = minimum(m.maxWithdrawPerAction, withdrawable);
      return {
        key,
        address: v.address,
        allowedByMandate: (m.allowedVaults & (key === 'LIQUID' ? 1 : 2)) !== 0,
        lockupSeconds: v.lockupSeconds.toString(),
        principal: v.principal.toString(),
        withdrawable: withdrawable.toString(),
        unlockAt: v.unlockAt.toString(),
        risk: v.riskLevel === 0 ? 'NORMAL' : 'DEGRADED',
        deposit: this.room(snapshot, nowMs, 'DEPOSIT', v.address, depositMax),
        withdraw: this.room(snapshot, nowMs, 'WITHDRAW', v.address, withdrawMax),
      };
    };
    return {
      owner: snapshot.owner,
      executor: snapshot.executor,
      mandateOperator: m.operator,
      isOperator: getAddress(m.operator) === this.address,
      active:
        snapshot.mandateVersion > 0n && !snapshot.paused && !snapshot.revoked && now < m.expiresAt,
      paused: snapshot.paused,
      revoked: snapshot.revoked,
      mandateVersion: snapshot.mandateVersion.toString(),
      expiresAt: m.expiresAt.toString(),
      idle: snapshot.idleBalance.toString(),
      cumulativeDeposited: snapshot.cumulativeDeposited.toString(),
      allocationCompleted: snapshot.allocationCompleted,
      limits: {
        maxDepositPerAction: m.maxDepositPerAction.toString(),
        maxCumulativeDeposits: m.maxCumulativeDeposits.toString(),
        maxWithdrawPerAction: m.maxWithdrawPerAction.toString(),
        allocationTarget: m.allocationTarget.toString(),
        maxLockupSeconds: m.maxLockupSeconds.toString(),
      },
      vaults: [vault('LIQUID'), vault('TIMED')],
      blockNumber: snapshot.blockNumber.toString(),
    };
  }

  /** Deposits idle MockUSDC from the owner's executor into a vault the mandate allows. */
  deposit(input: { owner: Address; vault: VaultKey; amount: bigint }) {
    return this.act('DEPOSIT', input);
  }

  /** Withdraws from a vault. The executor always pays the owner; the agent cannot redirect it. */
  withdraw(input: { owner: Address; vault: VaultKey; amount: bigint }) {
    return this.act('WITHDRAW', input);
  }

  private async act(
    kind: ActionKind,
    input: { owner: Address; vault: VaultKey; amount: bigint },
  ): Promise<ActionResult> {
    if (input.amount <= 0n) throw new BoundraOperatorError('NOTHING_TO_DO');
    const { snapshot, nowMs } = await this.observe(input.owner);
    const target = input.vault === 'LIQUID' ? snapshot.liquid.address : snapshot.timed.address;
    const prepared = this.prepare(snapshot, nowMs, kind, target, input.amount);
    let request;
    try {
      ({ request } = await this.reader.client.simulateContract({
        account: this.options.account,
        address: prepared.address,
        abi: prepared.abi,
        functionName: prepared.functionName,
        args: prepared.args,
      }));
    } catch (error) {
      const reason = (error as { shortMessage?: string }).shortMessage;
      throw new BoundraOperatorError(
        'SIMULATION_REVERTED',
        reason ? `${REFUSALS.SIMULATION_REVERTED} ${reason}` : undefined,
      );
    }
    const txHash = await this.wallet.writeContract(request);
    const receipt = await this.reader.client.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
    });
    if (receipt.status !== 'success') throw new BoundraOperatorError('REVERTED', undefined, txHash);
    return {
      kind,
      vault: input.vault,
      amount: input.amount.toString(),
      actionId: prepared.action.actionId as Hash,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
    };
  }

  private async observe(ownerInput: Address) {
    const owner = getAddress(ownerInput);
    const executor = await this.executorOf(owner);
    if (!executor) throw new BoundraOperatorError('NO_EXECUTOR');
    let snapshot: ExecutorSnapshot;
    try {
      snapshot = await this.reader.snapshot(owner, executor);
    } catch (error) {
      if (error instanceof ChainPolicyError) throw new BoundraOperatorError(error.code);
      throw error;
    }
    // A local clock slightly behind the chain is not a stale observation.
    const nowMs = Math.max(Date.now(), Number(snapshot.blockTimestamp) * 1000);
    return { snapshot, nowMs };
  }

  /** Checks one action against the confirmed mandate; throws the refusal code if it fails. */
  private prepare(
    snapshot: ExecutorSnapshot,
    nowMs: number,
    kind: ActionKind,
    target: Address,
    amount: bigint,
  ) {
    const now = BigInt(Math.floor(nowMs / 1000));
    const wanted = now + this.deadlineSeconds;
    const deadline = wanted < snapshot.mandate.expiresAt ? wanted : snapshot.mandate.expiresAt;
    try {
      return prepareAction(
        snapshot,
        {
          actionId: toHex(crypto.getRandomValues(new Uint8Array(32))),
          kind,
          mandateVersion: snapshot.mandateVersion.toString(),
          nonce: snapshot.nextActionNonce.toString(),
          deadline: deadline.toString(),
          target,
          amount: amount.toString(),
        },
        this.address,
        nowMs,
      );
    } catch (error) {
      if (error instanceof ChainPolicyError) throw new BoundraOperatorError(error.code);
      throw error;
    }
  }

  private room(
    snapshot: ExecutorSnapshot,
    nowMs: number,
    kind: ActionKind,
    target: Address,
    max: bigint,
  ): { max: string; refusal: string | null } {
    if (max <= 0n)
      return {
        max: '0',
        refusal:
          kind === 'DEPOSIT'
            ? snapshot.allocationCompleted
              ? 'ALLOCATION_COMPLETED'
              : snapshot.idleBalance === 0n
                ? 'INSUFFICIENT_FUNDING'
                : 'BUDGET_EXCEEDED'
            : 'WITHDRAWAL_UNAVAILABLE',
      };
    try {
      this.prepare(snapshot, nowMs, kind, target, max);
      return { max: max.toString(), refusal: null };
    } catch (error) {
      if (error instanceof BoundraOperatorError) return { max: '0', refusal: error.code };
      throw error;
    }
  }
}
