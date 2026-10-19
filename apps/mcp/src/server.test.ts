import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { decodeFunctionData, type Address } from 'viem';
import { boundraExecutorAbi } from '@boundra/chain';
import { BoundraApiError, BoundraOperatorError } from '@boundra/sdk';
import { depsFromEnv } from './config.js';
import { createBoundraServer, type ServerDeps } from './server.js';

const executor = '0x00000000000000000000000000000000000000e1';
const agent = '0x00000000000000000000000000000000000000d1' as Address;
const ownerAddress = '0x00000000000000000000000000000000000000b1';

const draft = {
  id: '5f0e8a8e-8c55-4c43-9f37-7a1c1f0a0b01',
  intentId: '5f0e8a8e-8c55-4c43-9f37-7a1c1f0a0b02',
  revision: 1,
  status: 'PREVIEWED',
  executor,
  tuple: {},
  preview: {
    owner: ownerAddress,
    operator: agent,
    operatorSource: 'OWNER',
    executor,
    beneficiary: ownerAddress,
    target: { vault: 'LIQUID', name: 'LiquidVault', address: '0x1', lockupSeconds: '0' },
    limits: {
      allocationTarget: '300000000',
      maxDepositPerAction: '300000000',
      maxWithdrawPerAction: '100000000',
    },
    expiresAt: '1800000000',
    notices: ['You chose the agent for this mandate yourself.'],
  },
  previewHash: '0x00',
  mandateHash: null,
  onchainVersion: null,
};

function fakeOwner(calls: unknown[][]): NonNullable<ServerDeps['owner']> {
  const record =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (value instanceof Error) throw value;
      return value;
    };
  return {
    dashboard: record('dashboard', {
      owner: ownerAddress,
      executor,
      mandate: null,
      chainStatus: 'ok',
      chain: null,
      labels: [],
    }),
    activity: record('activity', { items: [], nextBefore: null }),
    getMandate: record('getMandate', draft),
    startGoal: record('startGoal', {
      id: draft.intentId,
      state: 'CLARIFYING',
      question: {
        questionId: `${draft.intentId}:0`,
        text: 'Can your funds be locked for 30 days?',
        alternatives: [
          { id: 'no_lockup', label: 'No' },
          { id: 'unsure', label: 'Not sure' },
        ],
      },
    }),
    answer: record(
      'answer',
      new BoundraApiError(409, 'QUESTION_NOT_ACTIVE', 'That question is no longer active'),
    ),
    getIntent: record('getIntent', {}),
    draftMandate: record('draftMandate', draft),
    reviseMandate: record('reviseMandate', draft),
  } as unknown as NonNullable<ServerDeps['owner']>;
}

async function connect(deps: ServerDeps) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBoundraServer(deps).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

describe('Boundra MCP server', () => {
  it('without an owner token, explains how to get one instead of failing silently', async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['boundra_get_overview']);
    const result = await client.callTool({ name: 'boundra_get_overview', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Connect an app or AI assistant/);
  });

  it('offers owner tools that read and prepare, and none that approve or sign', async () => {
    const client = await connect({ owner: fakeOwner([]), appUrl: 'https://app.example' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      'boundra_get_overview',
      'boundra_list_activity',
      'boundra_get_mandate',
      'boundra_start_goal',
      'boundra_answer_question',
      'boundra_draft_mandate',
      'boundra_prepare_owner_action',
    ]);
    expect(names.some((n) => /approve|sign/.test(n))).toBe(false);
  });

  it('converts MockUSDC amounts and asks the owner each question', async () => {
    const calls: unknown[][] = [];
    const client = await connect({ owner: fakeOwner(calls) });
    const result = await client.callTool({
      name: 'boundra_start_goal',
      arguments: { objective: 'Manage 300 MockUSDC safely', amount: '300' },
    });
    expect(calls[0]).toEqual([
      'startGoal',
      { objective: 'Manage 300 MockUSDC safely', amount: 300_000_000n },
    ]);
    expect(text(result)).toMatch(/Ask the owner: Can your funds be locked/);
    expect(text(result)).toMatch(/- unsure: Not sure/);
    const bad = await client.callTool({
      name: 'boundra_start_goal',
      arguments: { objective: 'x', amount: '1e9' },
    });
    expect(bad.isError).toBe(true);
  });

  it('drafts with the owner’s own agent and leaves approval to the owner in the app', async () => {
    const calls: unknown[][] = [];
    const client = await connect({ owner: fakeOwner(calls), appUrl: 'https://app.example' });
    const result = await client.callTool({
      name: 'boundra_draft_mandate',
      arguments: { intentId: draft.intentId, operator: agent, maxWithdrawPerAction: '100' },
    });
    expect(calls[0]).toEqual([
      'draftMandate',
      draft.intentId,
      {
        operator: agent,
        expiryDays: undefined,
        maxDepositPerAction: undefined,
        maxWithdrawPerAction: 100_000_000n,
      },
    ]);
    expect(text(result)).toMatch(/the owner's own agent 0x0+d1 \(Boundra does not run it\)/);
    expect(text(result)).toMatch(
      /Only the owner can approve it: .* https:\/\/app\.example\/app\/mandates\/5f0e8a8e/,
    );
  });

  it('prepares owner actions unsigned, for the owner’s wallet', async () => {
    const client = await connect({ owner: fakeOwner([]) });
    const result = await client.callTool({
      name: 'boundra_prepare_owner_action',
      arguments: { action: 'pause' },
    });
    expect(text(result)).toMatch(/^Prepared, not signed: Pause the agent/);
    const call = JSON.parse((result.content as { text: string }[])[1]!.text) as {
      to: string;
      data: `0x${string}`;
      signedBy: string;
    };
    expect(call.to.toLowerCase()).toBe(executor);
    expect(decodeFunctionData({ abi: boundraExecutorAbi, data: call.data }).functionName).toBe(
      'pause',
    );
    expect(call.signedBy).toBe('the owner, in their own wallet');
    const missing = await client.callTool({
      name: 'boundra_prepare_owner_action',
      arguments: { action: 'recoverIdle' },
    });
    expect(missing.isError).toBe(true);
  });

  it('reports API refusals with their code and recovery', async () => {
    const client = await connect({ owner: fakeOwner([]) });
    const result = await client.callTool({
      name: 'boundra_answer_question',
      arguments: { intentId: draft.intentId, questionId: 'q', alternativeId: 'unsure' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('QUESTION_NOT_ACTIVE: That question is no longer active');
  });

  it('acts as a bounded operator and reports refusals', async () => {
    const actions: unknown[] = [];
    const operator = {
      address: agent,
      status: async () => {
        throw new BoundraOperatorError('NO_EXECUTOR');
      },
      deposit: async (input: unknown) => {
        actions.push(input);
        return {
          kind: 'DEPOSIT',
          vault: 'LIQUID',
          amount: '12500000',
          actionId: '0x01',
          txHash: '0xabc',
          blockNumber: '7',
        };
      },
      withdraw: async () => {
        throw new BoundraOperatorError('WITHDRAWAL_LIMIT');
      },
    } as unknown as NonNullable<ServerDeps['operator']>;
    const client = await connect({ operator });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      'boundra_get_overview',
      'boundra_operator_status',
      'boundra_deposit',
      'boundra_withdraw',
    ]);
    const deposit = await client.callTool({
      name: 'boundra_deposit',
      arguments: { owner: ownerAddress, vault: 'LIQUID', amount: '12.5' },
    });
    expect(actions[0]).toMatchObject({ vault: 'LIQUID', amount: 12_500_000n });
    expect(text(deposit)).toMatch(/^Deposited 12\.5 MockUSDC \(LIQUID\)\. Transaction 0xabc/);
    const withdraw = await client.callTool({
      name: 'boundra_withdraw',
      arguments: { owner: ownerAddress, vault: 'LIQUID', amount: '500' },
    });
    expect(withdraw.isError).toBe(true);
    expect(text(withdraw)).toMatch(/^WITHDRAWAL_LIMIT: The amount is above/);
  });
});

describe('configuration', () => {
  it('needs nothing secret to start, and never echoes a bad value', () => {
    expect(depsFromEnv({}).owner).toBeUndefined();
    const secret = '0xnot-a-key-but-could-be-secret';
    expect(() => depsFromEnv({ BOUNDRA_AGENT_PRIVATE_KEY: secret })).toThrow(
      /^Invalid Boundra MCP configuration: BOUNDRA_AGENT_PRIVATE_KEY$/,
    );
    expect(() => depsFromEnv({ BOUNDRA_AGENT_PRIVATE_KEY: `0x${'1'.repeat(64)}` })).toThrow(
      /BOUNDRA_MANIFEST_PATH/,
    );
    const deps = depsFromEnv({
      BOUNDRA_API_TOKEN: 't'.repeat(43),
      BOUNDRA_APP_URL: 'https://a.example/',
    });
    expect(deps.owner).toBeDefined();
    expect(deps.appUrl).toBe('https://a.example');
  });
});
