import { describe, expect, it } from 'vitest';
import { decodeFunctionData, getAddress, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { boundraExecutorAbi, mockUsdcAbi } from '@boundra/chain';
import {
  apiBase,
  BoundraApiError,
  BoundraClient,
  mockUsdc,
  ownerActionCall,
  ownerAuthorizationCalls,
  type ApprovedMandate,
} from './index';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records requests and answers from a route table. */
function fakeFetch(routes: Record<string, (body: unknown) => [number, unknown]>) {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ url, method, headers: init.headers as Record<string, string>, body });
    const route = routes[`${method} ${new URL(url).pathname}`];
    const [status, payload] = route ? route(body) : [404, { error: { code: 'NOT_FOUND' } }];
    return new Response(status === 204 ? null : JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

const executor = '0x00000000000000000000000000000000000000e1' as Address;
const tuple = {
  chainId: 84532 as const,
  asset: '0x00000000000000000000000000000000000000a1',
  operator: '0x00000000000000000000000000000000000000d1',
  beneficiary: '0x00000000000000000000000000000000000000b1',
  expiresAt: '1800000000',
  allowedVaults: 1,
  allowedActions: 3,
  maxLockupSeconds: '0',
  maxDepositPerAction: '300000000',
  maxCumulativeDeposits: '300000000',
  maxWithdrawPerAction: '300000000',
  allocationTarget: '300000000',
};
const approved = {
  ownerTransactions: {
    note: '',
    setMandate: { to: executor, functionName: 'setMandate', args: [tuple] },
    approve: { to: tuple.asset, functionName: 'approve', args: [executor, '300000000'] },
    fund: { to: executor, functionName: 'fund', args: ['300000000'] },
  },
} as unknown as ApprovedMandate;

describe('BoundraClient', () => {
  it('signs a token challenge with the owner’s wallet and then sends only the bearer token', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let signed = '';
    const { fetcher, seen } = fakeFetch({
      'POST /api/v1/auth/challenge': () => [201, { message: 'Give an app … API token' }],
      'POST /api/v1/auth/verify': (body) => {
        signed = (body as { signature: string }).signature;
        return [200, { address: account.address.toLowerCase(), token: 'tok', expiresAt: 'x' }];
      },
      'GET /api/v1/dashboard': () => [200, { chainStatus: 'ok' }],
    });
    const client = await BoundraClient.signIn({
      apiUrl: 'https://boundra.example',
      signer: account,
      fetch: fetcher,
    });
    expect(seen[0]!.body).toEqual({ address: account.address, client: 'token' });
    expect(signed).toBe(await account.signMessage({ message: 'Give an app … API token' }));
    expect(client.token).toBe('tok');
    await client.dashboard();
    expect(seen[2]!.url).toBe('https://boundra.example/api/v1/dashboard');
    expect(seen[2]!.headers.authorization).toBe('Bearer tok');
    expect(seen[2]!.headers.cookie).toBeUndefined();
  });

  it('sends amounts as base-unit strings and only the draft fields that were given', async () => {
    const { fetcher, seen } = fakeFetch({
      'POST /api/v1/intents': () => [201, { id: 'i1' }],
      'POST /api/v1/intents/i1/mandate-drafts': () => [201, { id: 'm1', status: 'PREVIEWED' }],
    });
    const client = new BoundraClient({ apiUrl: 'http://x/api/v1/', token: 't', fetch: fetcher });
    await client.startGoal({ objective: 'Manage 300 MockUSDC safely', amount: mockUsdc('300') });
    expect(seen[0]!.body).toEqual({
      objective: 'Manage 300 MockUSDC safely',
      amount: '300000000',
      chainId: 84532,
    });
    await client.draftMandate('i1', { operator: tuple.operator, maxDepositPerAction: 5n });
    expect(seen[1]!.body).toEqual({ operator: tuple.operator, maxDepositPerAction: '5' });
  });

  it('turns the API error envelope into a typed error', async () => {
    const { fetcher } = fakeFetch({
      'POST /api/v1/mandate-drafts/m1/approve': () => [
        409,
        { error: { code: 'STALE_PREVIEW', message: 'Changed', recovery: 'Reload.' } },
      ],
    });
    const client = new BoundraClient({ apiUrl: 'http://x', token: 't', fetch: fetcher });
    const error = await client.approveMandate('m1', '0x00').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BoundraApiError);
    expect(error).toMatchObject({ status: 409, code: 'STALE_PREVIEW', recovery: 'Reload.' });
  });

  it('accepts the app origin or its API URL, and nothing but http(s)', () => {
    expect(apiBase('https://a.example')).toBe('https://a.example/api/v1');
    expect(apiBase('https://a.example/api/v1/')).toBe('https://a.example/api/v1');
    expect(() => apiBase('file:///etc/passwd')).toThrow('Unsupported API URL');
  });
});

describe('owner transactions', () => {
  it('encodes exactly the approved mandate, then the approval and funding', () => {
    const [set, approve, fund] = ownerAuthorizationCalls(approved);
    const decodedSet = decodeFunctionData({ abi: boundraExecutorAbi, data: set!.data });
    expect(set!.to.toLowerCase()).toBe(executor);
    expect(decodedSet.functionName).toBe('setMandate');
    expect(decodedSet.args?.[0]).toMatchObject({
      operator: getAddress(tuple.operator),
      maxDepositPerAction: 300000000n,
      expiresAt: 1800000000n,
    });
    expect(decodeFunctionData({ abi: mockUsdcAbi, data: approve!.data }).args).toEqual([
      getAddress(executor),
      300000000n,
    ]);
    expect(decodeFunctionData({ abi: boundraExecutorAbi, data: fund!.data }).args).toEqual([
      300000000n,
    ]);
    expect(set!.description).toContain(`agent ${getAddress(tuple.operator)}`);
  });

  it('refuses owner transactions that disagree with each other', () => {
    const tampered = structuredClone(approved);
    tampered.ownerTransactions.approve.args[1] = '999';
    expect(() => ownerAuthorizationCalls(tampered)).toThrow('amounts differ');
  });

  it('prepares owner-only controls without signing them', () => {
    const pause = ownerActionCall(executor, { kind: 'pause' });
    expect(decodeFunctionData({ abi: boundraExecutorAbi, data: pause.data }).functionName).toBe(
      'pause',
    );
    const withdraw = ownerActionCall(executor, {
      kind: 'ownerWithdraw',
      vault: tuple.asset as Address,
      amount: 7n,
    });
    expect(decodeFunctionData({ abi: boundraExecutorAbi, data: withdraw.data }).args).toEqual([
      getAddress(tuple.asset),
      7n,
    ]);
  });
});
