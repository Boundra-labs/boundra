import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { formatAmount, VAULTS, ACCE_CONFIG_VERSION, DESCRIPTOR_VERSION } from '@boundra/acce';
import { BASE_SEPOLIA_CHAIN_ID, addressSchema } from '@boundra/shared';
import { ApiError } from '../common/errors';
import { AdminOnly, CurrentOwner, parse, Public, type AuthenticatedOwner } from '../common/request';
import { DatabaseService } from '../database.service';
import { CHAIN_GATEWAY, type ChainGateway } from '../chain/chain.gateway';
import { tupleOf } from '../mandates/mandates.service';

const activityQuery = z
  .object({
    before: z.coerce.bigint().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const resetSchema = z.object({ ownerAddress: addressSchema }).strict();

@ApiTags('account')
@Controller()
export class AccountController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CHAIN_GATEWAY) private readonly chain: ChainGateway,
  ) {}

  private get db() {
    return this.database.client;
  }

  @Public()
  @Get('config/public')
  @ApiOperation({ summary: 'Reviewed chain configuration and vault descriptors (no secrets)' })
  publicConfig() {
    const deployment = this.chain.deployment();
    return {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      network: 'Base Sepolia (testnet)',
      explorer: 'https://sepolia.basescan.org',
      configured: Boolean(deployment),
      contracts: deployment
        ? {
            factory: deployment.manifest.factory,
            mockUsdc: deployment.manifest.mockUsdc,
            faucet: deployment.manifest.faucet,
            liquidVault: deployment.manifest.liquidVault,
            timedVault: deployment.manifest.timedVault,
            riskAdmin: deployment.manifest.riskAdmin,
          }
        : null,
      operator: deployment?.operator ?? null,
      descriptorVersion: DESCRIPTOR_VERSION,
      acceConfigVersion: ACCE_CONFIG_VERSION,
      vaults: Object.values(VAULTS).map((vault) => ({
        key: vault.key,
        name: vault.name,
        lockupSeconds: vault.lockupSeconds.toString(),
        illustrativeYieldBps: vault.illustrativeYieldBps,
        note: 'Illustrative fixture metadata; the mock vault pays no yield.',
      })),
    };
  }

  @Post('executors/register')
  @HttpCode(200)
  @ApiCookieAuth('__Host-boundra_session')
  @ApiOperation({ summary: 'Register the executor the trusted factory created for your wallet' })
  async registerExecutor(@CurrentOwner() owner: AuthenticatedOwner) {
    const deployment = this.chain.deployment();
    const found = await this.chain.findExecutor(owner.address);
    if (!found || !deployment)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'EXECUTOR_NOT_REGISTERED',
        'The factory has no executor for your wallet yet',
        'Call createExecutor() on the factory, wait for confirmation, then try again.',
      );
    const executor = await this.db.executor.upsert({
      where: { ownerId: owner.id },
      create: {
        ownerId: owner.id,
        address: found.address,
        factory: deployment.manifest.factory.toLowerCase(),
        verifiedAtBlock: found.blockNumber.toString(),
      },
      update: { verifiedAtBlock: found.blockNumber.toString() },
    });
    if (executor.address !== found.address)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'INVALID_STATE',
        'A different executor is already registered',
      );
    return { address: executor.address, verifiedAtBlock: executor.verifiedAtBlock.toFixed(0) };
  }

  @Get('dashboard')
  @ApiCookieAuth('__Host-boundra_session')
  @ApiOperation({ summary: 'Mandate status and confirmed on-chain balances/positions' })
  async dashboard(@CurrentOwner() owner: AuthenticatedOwner) {
    const executor = await this.db.executor.findUnique({ where: { ownerId: owner.id } });
    const mandate = await this.db.mandate.findFirst({
      where: { ownerId: owner.id, status: { notIn: ['SUPERSEDED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
    });
    let chain: Record<string, unknown> | null = null;
    let chainStatus: 'ok' | 'degraded' | 'unconfigured' | 'no_executor' = 'no_executor';
    if (!this.chain.deployment()) chainStatus = 'unconfigured';
    else if (executor) {
      try {
        const s = await this.chain.snapshot(owner.address, executor.address);
        chainStatus = 'ok';
        chain = {
          blockNumber: s.blockNumber.toString(),
          blockHash: s.blockHash,
          mandateVersion: s.mandateVersion.toString(),
          paused: s.paused,
          revoked: s.revoked,
          allocationCompleted: s.allocationCompleted,
          cumulativeDeposited: s.cumulativeDeposited.toString(),
          idle: { baseUnits: s.idleBalance.toString(), display: formatAmount(s.idleBalance) },
          positions: [s.liquid, s.timed].map((vault) => ({
            address: vault.address,
            principal: vault.principal.toString(),
            display: formatAmount(vault.principal),
            unlockAt: vault.unlockAt.toString(),
            withdrawable: vault.maxWithdraw.toString(),
            risk: vault.riskLevel === 0 ? 'NORMAL' : 'DEGRADED',
          })),
        };
      } catch {
        chainStatus = 'degraded';
      }
    }
    return {
      labels: ['TESTNET', 'MockUSDC', 'Mock vault', 'Illustrative yield only'],
      owner: owner.address,
      executor: executor?.address ?? null,
      mandate: mandate
        ? {
            id: mandate.id,
            status: mandate.status,
            revision: mandate.revision,
            selectedVault: mandate.selectedVault,
            tuple: tupleOf(mandate),
            onchainVersion: mandate.onchainVersion?.toFixed(0) ?? null,
            escalationReason: mandate.escalationReason,
          }
        : null,
      chainStatus,
      chain,
    };
  }

  @Get('activity')
  @ApiCookieAuth('__Host-boundra_session')
  @ApiOperation({
    summary: 'Owner activity timeline, newest first; HOLD and denials carry no tx hash',
  })
  async activity(@CurrentOwner() owner: AuthenticatedOwner, @Query() query: unknown) {
    const { before, limit } = parse(activityQuery, query);
    const rows = await this.db.activityEvent.findMany({
      where: { ownerId: owner.id, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return {
      items: rows.map((row) => ({
        id: row.id.toString(),
        type: row.type,
        intentId: row.intentId,
        mandateId: row.mandateId,
        actionId: row.actionId,
        txHash: row.txHash,
        explorerUrl: row.txHash ? `https://sepolia.basescan.org/tx/${row.txHash}` : null,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
      nextBefore: rows.length === limit ? rows[rows.length - 1]!.id.toString() : null,
    };
  }

  @Post('admin/demo/reset')
  @HttpCode(200)
  @AdminOnly()
  @ApiCookieAuth('__Host-boundra_session')
  @ApiOperation({
    summary: 'Demo admin: close an owner’s open synthetic drafts; never touches chain evidence',
  })
  async reset(@CurrentOwner() admin: AuthenticatedOwner, @Body() body: unknown) {
    const { ownerAddress } = parse(resetSchema, body);
    const target = await this.db.walletIdentity.findUnique({
      where: { address: ownerAddress.toLowerCase() },
    });
    if (!target) return { intents: 0, mandates: 0 };
    return this.db.$transaction(async (tx) => {
      const mandates = await tx.mandate.updateMany({
        where: { ownerId: target.id, status: { in: ['DRAFT', 'PREVIEWED', 'APPROVED'] } },
        data: { status: 'SUPERSEDED' },
      });
      const intents = await tx.intent.updateMany({
        where: {
          ownerId: target.id,
          state: { in: ['INTENT_RECEIVED', 'CLARIFYING', 'MANDATE_PENDING'] },
        },
        data: { state: 'REJECTED' },
      });
      await tx.activityEvent.create({
        data: {
          ownerId: target.id,
          type: 'DEMO_RESET',
          payload: { by: admin.address, intents: intents.count, mandates: mandates.count },
        },
      });
      return { intents: intents.count, mandates: mandates.count };
    });
  }
}
