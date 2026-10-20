import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
  parseTransaction,
  stringToHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from 'viem';
import {
  actionRequestSchema,
  BoundraChainReader,
  boundraExecutorAbi,
  ChainPolicyError,
  prepareAction,
  type ActionRequest,
} from '@boundra/chain';

export type AttemptState = 'SIGNED' | 'BROADCAST' | 'CONFIRMED' | 'REVERTED' | 'RECONCILE';
export interface SignedAttempt {
  actionId: Hash;
  requestHash: Hash;
  action: ActionRequest;
  owner: Address;
  executor: Address;
  operator: Address;
  eoaNonce: number;
  rawTransaction: Hex;
  transactionHash: Hash;
  signedAtBlock: bigint;
  state: AttemptState;
}
export interface SignerLease {
  fencingToken: string;
  assertHeld(): Promise<void>;
}
/** Implement this with PostgreSQL, fencing, unique action/nonce reservations and encrypted raw transactions. */
export interface ExecutionStore {
  durable: true;
  withSignerLease<T>(key: string, work: (lease: SignerLease) => Promise<T>): Promise<T>;
  findAttempt(actionId: Hash): Promise<SignedAttempt | null>;
  reserveEoaNonce(actionId: Hash, minimumPendingNonce: number, lease: SignerLease): Promise<number>;
  saveSignedAttempt(attempt: SignedAttempt, lease: SignerLease): Promise<void>;
  reserveBroadcast(
    actionId: Hash,
    maxAttempts: number,
    minIntervalMs: number,
    lease: SignerLease,
  ): Promise<boolean>;
  recordState(
    actionId: Hash,
    state: AttemptState,
    detail: { code?: string; blockNumber?: string; blockHash?: Hash },
    lease: SignerLease,
  ): Promise<void>;
}
export interface ExecutionLimits {
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const MAX_BROADCASTS = 3;
// Persisted total including normal sends; extra sends only release an expired attempt's nonce.
const MAX_RELEASE_BROADCASTS = 6;
const BROADCAST_INTERVAL_MS = 10_000;

function encodeAction(action: ActionRequest): Hex {
  const args = [
    action.actionId as Hex,
    BigInt(action.mandateVersion),
    BigInt(action.nonce),
    BigInt(action.deadline),
    action.target as Address,
    BigInt(action.amount),
  ] as const;
  const functionName = action.kind === 'DEPOSIT' ? 'executeDeposit' : 'executeWithdraw';
  return encodeFunctionData({ abi: boundraExecutorAbi, functionName, args });
}

/** Registered by the worker runtime together with the durable PostgreSQL execution store. */
export class OperatorExecutionService {
  constructor(
    private readonly reader: BoundraChainReader,
    private readonly account: LocalAccount,
    private readonly store: ExecutionStore,
    private readonly limits: ExecutionLimits,
  ) {
    if (
      store.durable !== true ||
      limits.maxGas <= 0n ||
      limits.maxFeePerGas <= 0n ||
      limits.maxPriorityFeePerGas < 0n ||
      limits.maxPriorityFeePerGas > limits.maxFeePerGas
    )
      throw new Error('Durable storage and bounded gas configuration required');
    if (same(account.address, reader.manifest.riskAdmin))
      throw new ChainPolicyError('OPERATOR_IS_RISK_ADMIN');
  }

  async execute(
    ownerInput: Address,
    executorInput: Address,
    input: unknown,
  ): Promise<AttemptState> {
    const owner = getAddress(ownerInput);
    const executor = getAddress(executorInput);
    const parsed = actionRequestSchema.parse(input);
    const action = {
      ...parsed,
      actionId: parsed.actionId.toLowerCase(),
      target: getAddress(parsed.target),
    };
    const actionId = action.actionId as Hash;
    const requestHash = keccak256(
      stringToHex(
        JSON.stringify({
          owner: owner.toLowerCase(),
          executor: executor.toLowerCase(),
          ...action,
          target: action.target.toLowerCase(),
        }),
      ),
    );
    return this.store.withSignerLease(
      `84532:${this.account.address.toLowerCase()}`,
      async (lease) => {
        await lease.assertHeld();
        if ((await this.reader.client.getChainId()) !== 84532)
          throw new ChainPolicyError('WRONG_CHAIN');
        const existing = await this.store.findAttempt(actionId);
        if (existing) {
          if (
            existing.requestHash !== requestHash ||
            !same(existing.operator, this.account.address)
          )
            throw new ChainPolicyError('ACTION_ID_CONFLICT');
          return this.reconcile(existing, lease);
        }
        const snapshot = await this.reader.snapshot(owner, executor);
        const call = prepareAction(snapshot, action, this.account.address);
        // Simulate latest pending state, not only the confirmed observation. Revocation/risk changes win on-chain.
        await this.reader.client.simulateContract({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
          account: this.account.address,
          blockTag: 'pending',
        });
        const [gas, fees, pendingNonce] = await Promise.all([
          this.reader.client.estimateGas({
            account: this.account.address,
            to: executor,
            data: call.data,
          }),
          this.reader.client.estimateFeesPerGas(),
          this.reader.client.getTransactionCount({
            address: this.account.address,
            blockTag: 'pending',
          }),
        ]);
        // Add a bounded 20% buffer without silently raising user/operator configured fee caps.
        const gasLimit = (gas * 120n + 99n) / 100n;
        if (
          gasLimit > this.limits.maxGas ||
          fees.maxFeePerGas === undefined ||
          fees.maxPriorityFeePerGas === undefined ||
          fees.maxFeePerGas > this.limits.maxFeePerGas ||
          fees.maxPriorityFeePerGas > this.limits.maxPriorityFeePerGas
        )
          throw new ChainPolicyError('GAS_LIMIT');
        await lease.assertHeld();
        const eoaNonce = await this.store.reserveEoaNonce(actionId, pendingNonce, lease);
        if (!Number.isSafeInteger(eoaNonce) || eoaNonce < pendingNonce)
          throw new ChainPolicyError('INVALID_EOA_NONCE_RESERVATION');
        // Refresh after estimation/reservation so no stale snapshot is signed after slow provider calls.
        const fresh = await this.reader.snapshot(owner, executor);
        const refreshed = prepareAction(fresh, action, this.account.address);
        if (refreshed.data !== call.data) throw new ChainPolicyError('ACTION_CHANGED');
        await this.reader.client.simulateContract({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
          account: this.account.address,
          blockTag: 'pending',
        });
        await lease.assertHeld();
        const rawTransaction = await this.account.signTransaction({
          chainId: 84532,
          type: 'eip1559',
          to: executor,
          value: 0n,
          data: call.data,
          nonce: eoaNonce,
          gas: gasLimit,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        const attempt: SignedAttempt = {
          actionId,
          requestHash,
          action,
          owner,
          executor,
          operator: this.account.address,
          eoaNonce,
          rawTransaction,
          transactionHash: keccak256(rawTransaction),
          signedAtBlock: fresh.blockNumber,
          state: 'SIGNED',
        };
        await lease.assertHeld();
        // Atomic action/EOA/contract-nonce uniqueness and fencing are the store's mandatory responsibility.
        await this.store.saveSignedAttempt(attempt, lease);
        return this.broadcast(attempt, lease);
      },
    );
  }

  private async reconcile(attempt: SignedAttempt, lease: SignerLease): Promise<AttemptState> {
    // Every receipt, including a previous revert, is checked again after a possible reorg.
    let receipt: TransactionReceipt;
    try {
      receipt = await this.reader.client.getTransactionReceipt({ hash: attempt.transactionHash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError)
        return this.recoverMissing(attempt, lease);
      await this.store.recordState(
        attempt.actionId,
        'RECONCILE',
        { code: 'RECEIPT_UNAVAILABLE' },
        lease,
      );
      return 'RECONCILE';
    }
    const block = await this.reader.client.getBlock({ blockNumber: receipt.blockNumber });
    if (
      block.hash !== receipt.blockHash ||
      !receipt.to ||
      !same(receipt.to, attempt.executor) ||
      !same(receipt.from, attempt.operator)
    ) {
      await this.store.recordState(
        attempt.actionId,
        'RECONCILE',
        { code: 'RECEIPT_NOT_CANONICAL' },
        lease,
      );
      return 'RECONCILE';
    }
    const head = await this.reader.client.getBlockNumber({ cacheTime: 0 });
    if (head < receipt.blockNumber + BigInt(this.reader.confirmations - 1)) {
      await this.store.recordState(
        attempt.actionId,
        'BROADCAST',
        { code: 'AWAITING_CONFIRMATIONS' },
        lease,
      );
      return 'BROADCAST';
    }
    if (receipt.status === 'reverted') {
      await this.store.recordState(
        attempt.actionId,
        'REVERTED',
        { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash },
        lease,
      );
      return 'REVERTED';
    }
    const events = parseEventLogs({
      abi: boundraExecutorAbi,
      eventName: 'ActionExecuted',
      logs: receipt.logs,
      strict: true,
    });
    const matching = events.filter(
      (event) =>
        same(event.address, attempt.executor) &&
        event.args.actionId.toLowerCase() === attempt.actionId &&
        event.args.version === BigInt(attempt.action.mandateVersion) &&
        event.args.nonce === BigInt(attempt.action.nonce) &&
        event.args.action === (attempt.action.kind === 'DEPOSIT' ? 1 : 2) &&
        same(event.args.target, attempt.action.target) &&
        event.args.amount === BigInt(attempt.action.amount),
    );
    if (matching.length !== 1) {
      await this.store.recordState(
        attempt.actionId,
        'RECONCILE',
        { code: 'EXECUTION_EVENT_MISMATCH' },
        lease,
      );
      return 'RECONCILE';
    }
    await this.store.recordState(
      attempt.actionId,
      'CONFIRMED',
      { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash },
      lease,
    );
    return 'CONFIRMED';
  }

  private async broadcast(
    attempt: SignedAttempt,
    lease: SignerLease,
    maxAttempts = MAX_BROADCASTS,
    code?: string,
  ): Promise<AttemptState> {
    await lease.assertHeld();
    if (
      !(await this.store.reserveBroadcast(
        attempt.actionId,
        maxAttempts,
        BROADCAST_INTERVAL_MS,
        lease,
      ))
    ) {
      await this.store.recordState(
        attempt.actionId,
        'RECONCILE',
        { code: 'BROADCAST_RETRY_BUDGET' },
        lease,
      );
      return 'RECONCILE';
    }
    await lease.assertHeld();
    try {
      const hash = await this.reader.client.sendRawTransaction({
        serializedTransaction: attempt.rawTransaction,
      });
      if (hash !== attempt.transactionHash) throw new Error('Unexpected broadcast hash');
      await this.store.recordState(attempt.actionId, 'BROADCAST', code ? { code } : {}, lease);
      return 'BROADCAST';
    } catch {
      await this.store.recordState(
        attempt.actionId,
        'RECONCILE',
        { code: 'BROADCAST_OUTCOME_UNKNOWN' },
        lease,
      );
      return 'RECONCILE';
    }
  }

  private async recoverMissing(attempt: SignedAttempt, lease: SignerLease): Promise<AttemptState> {
    try {
      const transaction = await this.reader.client.getTransaction({
        hash: attempt.transactionHash,
      });
      if (
        transaction.hash === attempt.transactionHash &&
        same(transaction.from, attempt.operator) &&
        transaction.to &&
        same(transaction.to, attempt.executor) &&
        transaction.blockNumber === null
      ) {
        await this.store.recordState(
          attempt.actionId,
          'BROADCAST',
          { code: 'PENDING_ON_CHAIN' },
          lease,
        );
        return 'BROADCAST';
      }
    } catch (error) {
      if (error instanceof TransactionNotFoundError) {
        const [confirmedNonce, pendingNonce] = await Promise.all([
          this.reader.client.getTransactionCount({ address: attempt.operator, blockTag: 'latest' }),
          this.reader.client.getTransactionCount({
            address: attempt.operator,
            blockTag: 'pending',
          }),
        ]);
        if (confirmedNonce <= attempt.eoaNonce && pendingNonce === attempt.eoaNonce) {
          // Recover crash-after-persist or a dropped tx by replaying identical signed bytes only.
          // Do not allocate a fresh EOA nonce/action ID or silently change fees/calldata.
          const signed = parseTransaction(attempt.rawTransaction);
          if (
            keccak256(attempt.rawTransaction) !== attempt.transactionHash ||
            signed.chainId !== 84532 ||
            signed.nonce !== attempt.eoaNonce ||
            !signed.to ||
            !same(signed.to, attempt.executor) ||
            signed.data !== encodeAction(attempt.action) ||
            (signed.value ?? 0n) !== 0n ||
            !signed.gas ||
            signed.gas > this.limits.maxGas ||
            signed.maxFeePerGas === undefined ||
            signed.maxFeePerGas > this.limits.maxFeePerGas ||
            signed.maxPriorityFeePerGas === undefined ||
            signed.maxPriorityFeePerGas > this.limits.maxPriorityFeePerGas
          )
            throw new ChainPolicyError('SIGNED_ATTEMPT_MISMATCH');
          if (await this.deadlineElapsed(attempt)) {
            // The executor rejects deadline <= block.timestamp, so these bytes can only revert.
            // Mining that revert consumes the reserved EOA nonce instead of leaving a permanent gap.
            return this.broadcast(
              attempt,
              lease,
              MAX_RELEASE_BROADCASTS,
              'NONCE_RELEASE_BROADCAST',
            );
          }
          try {
            const current = await this.reader.snapshot(attempt.owner, attempt.executor);
            const call = prepareAction(current, attempt.action, this.account.address);
            await this.reader.client.simulateContract({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args,
              account: this.account.address,
              blockTag: 'pending',
            });
          } catch {
            // Pause, risk or state changes must not be overridden by an old candidate.
            // Hold the nonce until the deadline makes a release broadcast safe.
            await this.store.recordState(
              attempt.actionId,
              'RECONCILE',
              { code: 'RESEND_BLOCKED_UNTIL_DEADLINE' },
              lease,
            );
            return 'RECONCILE';
          }
          return this.broadcast(attempt, lease);
        }
      }
    }
    await this.store.recordState(
      attempt.actionId,
      'RECONCILE',
      { code: 'NONCE_OR_RECEIPT_UNRESOLVED' },
      lease,
    );
    return 'RECONCILE';
  }

  private async deadlineElapsed(attempt: SignedAttempt): Promise<boolean> {
    // Use a confirmed block: later canonical blocks cannot carry an earlier timestamp.
    const head = await this.reader.client.getBlockNumber({ cacheTime: 0 });
    const depth = BigInt(this.reader.confirmations - 1);
    if (head < depth) return false;
    const block = await this.reader.client.getBlock({ blockNumber: head - depth });
    return BigInt(attempt.action.deadline) <= block.timestamp;
  }
}
