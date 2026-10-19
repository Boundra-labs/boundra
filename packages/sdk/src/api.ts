import type { Address, Hex } from 'viem';
import type { MandateTuple } from '@boundra/shared';

/** Anything that signs an EIP-191 message for an address: a viem account or wallet adapter. */
export interface MessageSigner {
  address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
}

/** The API's error envelope: a stable `code`, a message, and what to do about it. */
export class BoundraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = 'BoundraApiError';
  }
}

export interface Question {
  questionId: string;
  dimension: string;
  text: string;
  alternatives: { id: string; label: string }[];
  wordingSource: string;
}

export interface IntentView {
  id: string;
  state: string;
  objective: string;
  amount: { baseUnits: string; display: string };
  question: Question | null;
  answered: { questionId: string; dimension: string; answerId: string | null; status: string }[];
  selection: { action: string; vault?: string; reasonCode: string; reason: string } | null;
  [field: string]: unknown;
}

export interface MandatePreview {
  owner: string;
  operator: string;
  /** 'OWNER' when the owner named their own agent; absent for Boundra's agent. */
  operatorSource?: 'OWNER';
  executor: string | null;
  beneficiary: string;
  target: { vault: 'LIQUID' | 'TIMED'; name: string; address: string; lockupSeconds: string };
  limits: Record<string, string>;
  expiresAt: string;
  notices: string[];
  plainSummary?: { text: string; source: string };
  [field: string]: unknown;
}

export interface MandateView {
  id: string;
  intentId: string;
  revision: number;
  status: string;
  executor: string | null;
  tuple: MandateTuple;
  preview: MandatePreview;
  previewHash: Hex;
  mandateHash: Hex | null;
  onchainVersion: string | null;
  [field: string]: unknown;
}

/** Returned instead of a draft when no vault fits the owner's answers; nothing is delegated. */
export interface Escalation {
  status: 'ESCALATED';
  reasonCode: string;
  reason: string;
}

export interface ApprovedMandate extends MandateView {
  ownerTransactions: {
    note: string;
    setMandate: { to: string; functionName: 'setMandate'; args: [MandateTuple] };
    approve: { to: string; functionName: 'approve'; args: [string, string] };
    fund: { to: string; functionName: 'fund'; args: [string] };
  };
}

export interface DraftOptions {
  /** Your own agent's address. Omit for Boundra's agent, or to keep the draft's agent on edits. */
  operator?: string;
  expiryDays?: number;
  maxDepositPerAction?: bigint | string;
  maxWithdrawPerAction?: bigint | string;
}

export interface ActivityItem {
  id: string;
  type: string;
  intentId: string | null;
  mandateId: string | null;
  actionId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  payload: unknown;
  createdAt: string;
}

export interface Dashboard {
  labels: string[];
  owner: string;
  executor: string | null;
  mandate: {
    id: string;
    status: string;
    revision: number;
    selectedVault: string;
    tuple: MandateTuple;
    onchainVersion: string | null;
    escalationReason: string | null;
  } | null;
  chainStatus: 'ok' | 'degraded' | 'unconfigured' | 'no_executor';
  chain: Record<string, unknown> | null;
}

export interface PublicConfig {
  chainId: 84532;
  network: string;
  explorer: string;
  configured: boolean;
  contracts: Record<
    'factory' | 'mockUsdc' | 'faucet' | 'liquidVault' | 'timedVault' | 'riskAdmin',
    Address
  > | null;
  /** Boundra's own agent; null when the deployment runs none. */
  operator: Address | null;
  [field: string]: unknown;
}

export interface ClientOptions {
  /** The Boundra app's origin (e.g. https://boundra.example) or its `/api/v1` URL. */
  apiUrl: string;
  /** An API token from `BoundraClient.signIn` or the app's "Connect an app" page. */
  token: string;
  fetch?: typeof fetch;
}

const amountString = (value: bigint | string | undefined) =>
  value === undefined ? undefined : value.toString();

export function apiBase(apiUrl: string) {
  const url = new URL(apiUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported API URL');
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path.endsWith('/api/v1') ? path : `${path}/api/v1`}`;
}

async function call<T>(
  fetcher: typeof fetch,
  base: string,
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const response = await fetcher(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as {
    error?: { code: string; message: string; recovery?: string };
  } | null;
  if (!response.ok)
    throw new BoundraApiError(
      response.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? `Boundra API answered ${response.status}`,
      body?.error?.recovery,
    );
  return body as T;
}

/**
 * Owner-side client for the Boundra API. It reads the owner's account and prepares mandates for
 * them to review. It never holds the owner's key: everything that changes the chain is returned
 * as a transaction for the owner's own wallet to sign.
 */
export class BoundraClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  readonly token: string;

  constructor(options: ClientOptions) {
    this.base = apiBase(options.apiUrl);
    this.fetcher = options.fetch ?? fetch;
    this.token = options.token;
  }

  /**
   * Signs in with the owner's wallet and returns a client holding a new API token. The wallet
   * signs a SIWE message stating that the token cannot sign transactions or move funds.
   */
  static async signIn(options: {
    apiUrl: string;
    signer: MessageSigner;
    fetch?: typeof fetch;
  }): Promise<BoundraClient> {
    const base = apiBase(options.apiUrl);
    const fetcher = options.fetch ?? fetch;
    const challenge = await call<{ message: string }>(fetcher, base, '/auth/challenge', {
      method: 'POST',
      body: { address: options.signer.address, client: 'token' },
    });
    const signature = await options.signer.signMessage({ message: challenge.message });
    const grant = await call<{ token: string }>(fetcher, base, '/auth/verify', {
      method: 'POST',
      body: { message: challenge.message, signature },
    });
    return new BoundraClient({ apiUrl: options.apiUrl, token: grant.token, fetch: fetcher });
  }

  /** Reviewed contract addresses and Boundra's agent; needs no sign-in. */
  static publicConfig(apiUrl: string, fetcher: typeof fetch = fetch) {
    return call<PublicConfig>(fetcher, apiBase(apiUrl), '/config/public');
  }

  private request<T>(path: string, method = 'GET', body?: unknown) {
    return call<T>(this.fetcher, this.base, path, { method, body, token: this.token });
  }

  session() {
    return this.request<{ address: Address; kind: 'browser' | 'token'; admin: boolean }>(
      '/auth/session',
    );
  }

  /** Revokes this client's API token. */
  signOut() {
    return this.request<void>('/auth/logout', 'POST');
  }

  /** Records the executor the factory created for the owner (after `createExecutor()`). */
  registerExecutor() {
    return this.request<{ address: Address; verifiedAtBlock: string }>(
      '/executors/register',
      'POST',
    );
  }

  /** Starts a goal; the answer carries the first clarifying question. Amount in base units. */
  startGoal(input: { objective: string; amount: bigint | string }) {
    return this.request<IntentView>('/intents', 'POST', {
      objective: input.objective,
      amount: input.amount.toString(),
      chainId: 84532,
    });
  }

  getIntent(intentId: string) {
    return this.request<IntentView>(`/intents/${encodeURIComponent(intentId)}`);
  }

  /** Answers the active question; "unsure" is always an allowed alternative. */
  answer(intentId: string, questionId: string, alternativeId: string) {
    return this.request<IntentView>(`/intents/${encodeURIComponent(intentId)}/answers`, 'POST', {
      questionId,
      alternativeId,
    });
  }

  draftMandate(intentId: string, options: DraftOptions = {}) {
    return this.request<MandateView | Escalation>(
      `/intents/${encodeURIComponent(intentId)}/mandate-drafts`,
      'POST',
      draftBody(options),
    );
  }

  getMandate(mandateId: string) {
    return this.request<MandateView>(`/mandate-drafts/${encodeURIComponent(mandateId)}`);
  }

  /** Every edit is a new revision that needs its own review. */
  reviseMandate(mandateId: string, options: DraftOptions) {
    return this.request<MandateView>(
      `/mandate-drafts/${encodeURIComponent(mandateId)}`,
      'PATCH',
      draftBody(options),
    );
  }

  /**
   * Approves exactly the previewed revision. Nothing is active until the owner's wallet sends
   * the returned transactions (see `ownerAuthorizationCalls`).
   */
  approveMandate(mandateId: string, previewHash: string) {
    return this.request<ApprovedMandate>(
      `/mandate-drafts/${encodeURIComponent(mandateId)}/approve`,
      'POST',
      { previewHash },
    );
  }

  /** Asks the worker to verify the owner's on-chain authorization. */
  checkAuthorization(mandateId: string, txHash?: string) {
    return this.request<{ status: string }>(
      `/mandate-drafts/${encodeURIComponent(mandateId)}/authorization-check`,
      'POST',
      txHash ? { txHash } : {},
    );
  }

  dashboard() {
    return this.request<Dashboard>('/dashboard');
  }

  activity(options: { before?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (options.before) query.set('before', options.before);
    if (options.limit) query.set('limit', String(options.limit));
    const suffix = query.size ? `?${query}` : '';
    return this.request<{ items: ActivityItem[]; nextBefore: string | null }>(`/activity${suffix}`);
  }
}

function draftBody(options: DraftOptions) {
  return Object.fromEntries(
    Object.entries({
      operator: options.operator,
      expiryDays: options.expiryDays,
      maxDepositPerAction: amountString(options.maxDepositPerAction),
      maxWithdrawPerAction: amountString(options.maxWithdrawPerAction),
    }).filter(([, value]) => value !== undefined),
  );
}

export const isEscalation = (value: MandateView | Escalation): value is Escalation =>
  value.status === 'ESCALATED';
