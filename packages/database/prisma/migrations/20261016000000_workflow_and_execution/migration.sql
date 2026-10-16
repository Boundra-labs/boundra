/*
  Warnings:

  - Added the required column `address` to the `AuthChallenge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `chainId` to the `AuthChallenge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `domain` to the `AuthChallenge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `issuedAt` to the `AuthChallenge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `uri` to the `AuthChallenge` table without a default value. This is not possible if the table is not empty.
  - Added the required column `csrfTokenHash` to the `AuthSession` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'UNKNOWN', 'ESCALATE');

-- CreateEnum
CREATE TYPE "PreferenceSource" AS ENUM ('INPUT', 'ANSWER', 'DEFAULT');

-- CreateEnum
CREATE TYPE "WordingSource" AS ENUM ('TEMPLATE', 'LLM');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'APPROVED', 'AUTHORIZED', 'SUPERSEDED', 'REVOKED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('DEPOSIT', 'WITHDRAW', 'HOLD', 'ESCALATE');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "AttemptState" AS ENUM ('SIGNED', 'BROADCAST', 'CONFIRMED', 'REVERTED', 'RECONCILE');

-- CreateEnum
CREATE TYPE "NonceReservationStatus" AS ENUM ('RESERVED', 'SIGNED', 'RELEASED');

-- CreateEnum
CREATE TYPE "RiskEventStatus" AS ENUM ('CANONICAL', 'ORPHANED');

-- Auth was not implemented before this migration; challenges (5-minute lifetime) and sessions
-- are ephemeral, so clearing them lets the new NOT NULL columns apply to existing databases.
DELETE FROM "AuthChallenge";
DELETE FROM "AuthSession";

-- AlterTable
ALTER TABLE "AuthChallenge" ADD COLUMN     "address" VARCHAR(42) NOT NULL,
ADD COLUMN     "chainId" INTEGER NOT NULL,
ADD COLUMN     "domain" VARCHAR(255) NOT NULL,
ADD COLUMN     "issuedAt" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "uri" VARCHAR(2048) NOT NULL;

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "csrfTokenHash" VARCHAR(64) NOT NULL,
ADD COLUMN     "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Intent" ADD COLUMN     "acceConfigVersion" VARCHAR(32) NOT NULL DEFAULT 'v1',
ADD COLUMN     "descriptorVersion" VARCHAR(32) NOT NULL DEFAULT 'v1',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "lastError" VARCHAR(500),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "questionId" VARCHAR(100) NOT NULL,
    "order" INTEGER NOT NULL,
    "dimension" VARCHAR(64) NOT NULL,
    "alternatives" JSONB NOT NULL,
    "actionDisagreement" VARCHAR(1000) NOT NULL,
    "materiality" INTEGER NOT NULL,
    "uncertainty" INTEGER NOT NULL,
    "decisionFlip" INTEGER NOT NULL,
    "friction" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "wordingSource" "WordingSource" NOT NULL,
    "answerId" VARCHAR(64),
    "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "askedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMPTZ(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceRecord" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "dimension" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "source" "PreferenceSource" NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Executor" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 84532,
    "address" VARCHAR(42) NOT NULL,
    "factory" VARCHAR(42) NOT NULL,
    "verifiedAtBlock" DECIMAL(78,0) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Executor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "executorId" UUID,
    "revision" INTEGER NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'DRAFT',
    "chainId" INTEGER NOT NULL DEFAULT 84532,
    "asset" VARCHAR(42) NOT NULL,
    "operator" VARCHAR(42) NOT NULL,
    "beneficiary" VARCHAR(42) NOT NULL,
    "expiresAt" DECIMAL(78,0) NOT NULL,
    "allowedVaults" INTEGER NOT NULL,
    "allowedActions" INTEGER NOT NULL,
    "maxLockupSeconds" BIGINT NOT NULL,
    "maxDepositPerAction" DECIMAL(78,0) NOT NULL,
    "maxCumulativeDeposits" DECIMAL(78,0) NOT NULL,
    "maxWithdrawPerAction" DECIMAL(78,0) NOT NULL,
    "allocationTarget" DECIMAL(78,0) NOT NULL,
    "selectedVault" VARCHAR(16),
    "preview" JSONB,
    "previewHash" VARCHAR(66),
    "mandateHash" VARCHAR(66),
    "approvedAt" TIMESTAMPTZ(3),
    "onchainVersion" DECIMAL(78,0),
    "authorizationTxHash" VARCHAR(66),
    "authorizedBlock" DECIMAL(78,0),
    "authorizedAt" TIMESTAMPTZ(3),
    "fundedAtBlock" DECIMAL(78,0),
    "escalatedAt" TIMESTAMPTZ(3),
    "escalationReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "mandateId" UUID NOT NULL,
    "kind" "DecisionKind" NOT NULL,
    "trigger" VARCHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "reasonSummary" VARCHAR(1000) NOT NULL,
    "candidates" JSONB NOT NULL,
    "snapshotBlock" DECIMAL(78,0) NOT NULL,
    "snapshotBlockHash" VARCHAR(66) NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProposal" (
    "actionId" VARCHAR(66) NOT NULL,
    "decisionId" UUID NOT NULL,
    "mandateId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 84532,
    "executor" VARCHAR(42) NOT NULL,
    "onchainVersion" DECIMAL(78,0) NOT NULL,
    "contractNonce" DECIMAL(78,0) NOT NULL,
    "proposalSeq" INTEGER NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "target" VARCHAR(42) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "deadline" DECIMAL(78,0) NOT NULL,
    "envelope" JSONB NOT NULL,
    "state" "WorkflowState" NOT NULL DEFAULT 'ACTION_PROPOSED',
    "rejectionCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("actionId")
);

-- CreateTable
CREATE TABLE "PolicyCheck" (
    "id" UUID NOT NULL,
    "actionId" VARCHAR(66) NOT NULL,
    "verifierVersion" VARCHAR(32) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "codes" TEXT[],
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "key" VARCHAR(200) NOT NULL,
    "holder" VARCHAR(100) NOT NULL,
    "fencingToken" BIGINT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EoaNonceReservation" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "operator" VARCHAR(42) NOT NULL,
    "eoaNonce" BIGINT NOT NULL,
    "actionId" VARCHAR(66) NOT NULL,
    "status" "NonceReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "fencingToken" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EoaNonceReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAttempt" (
    "actionId" VARCHAR(66) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "requestHash" VARCHAR(66) NOT NULL,
    "action" JSONB NOT NULL,
    "owner" VARCHAR(42) NOT NULL,
    "executor" VARCHAR(42) NOT NULL,
    "operator" VARCHAR(42) NOT NULL,
    "eoaNonce" BIGINT NOT NULL,
    "contractNonce" DECIMAL(78,0) NOT NULL,
    "rawTxCiphertext" BYTEA NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "signedAtBlock" DECIMAL(78,0) NOT NULL,
    "state" "AttemptState" NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSendAt" TIMESTAMPTZ(3),
    "lastCode" VARCHAR(64),
    "receiptBlockNumber" DECIMAL(78,0),
    "receiptBlockHash" VARCHAR(66),
    "fencingToken" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TransactionAttempt_pkey" PRIMARY KEY ("actionId")
);

-- CreateTable
CREATE TABLE "AttemptEvent" (
    "id" BIGSERIAL NOT NULL,
    "actionId" VARCHAR(66) NOT NULL,
    "state" "AttemptState" NOT NULL,
    "code" VARCHAR(64),
    "blockNumber" DECIMAL(78,0),
    "blockHash" VARCHAR(66),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCursor" (
    "key" VARCHAR(200) NOT NULL,
    "nextBlock" DECIMAL(78,0) NOT NULL,
    "previousBlockHash" VARCHAR(66),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MonitorCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" DECIMAL(78,0) NOT NULL,
    "blockHash" VARCHAR(66) NOT NULL,
    "source" VARCHAR(42) NOT NULL,
    "eventRiskLevel" INTEGER NOT NULL,
    "eventCapacity" DECIMAL(78,0) NOT NULL,
    "observedAtBlock" DECIMAL(78,0) NOT NULL,
    "observedAtBlockHash" VARCHAR(66) NOT NULL,
    "currentRiskLevel" INTEGER NOT NULL,
    "currentCapacity" DECIMAL(78,0) NOT NULL,
    "status" "RiskEventStatus" NOT NULL DEFAULT 'CANONICAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" BIGSERIAL NOT NULL,
    "ownerId" UUID NOT NULL,
    "intentId" UUID,
    "mandateId" UUID,
    "actionId" VARCHAR(66),
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "txHash" VARCHAR(66),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" UUID NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "split" VARCHAR(16) NOT NULL,
    "fixtureVersion" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(64),
    "promptVersion" VARCHAR(32) NOT NULL,
    "configVersion" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCaseResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "personaId" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "mismatch" BOOLEAN,
    "questions" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationCaseResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Question_questionId_key" ON "Question"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_intentId_order_key" ON "Question"("intentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceRecord_intentId_dimension_version_key" ON "PreferenceRecord"("intentId", "dimension", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Executor_ownerId_key" ON "Executor"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Executor_address_key" ON "Executor"("address");

-- CreateIndex
CREATE INDEX "Mandate_ownerId_createdAt_idx" ON "Mandate"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Mandate_status_idx" ON "Mandate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_intentId_revision_key" ON "Mandate"("intentId", "revision");

-- CreateIndex
CREATE INDEX "Decision_mandateId_createdAt_idx" ON "Decision"("mandateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_decisionId_key" ON "ActionProposal"("decisionId");

-- CreateIndex
CREATE INDEX "ActionProposal_mandateId_createdAt_idx" ON "ActionProposal"("mandateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_chainId_executor_contractNonce_proposalSeq_key" ON "ActionProposal"("chainId", "executor", "contractNonce", "proposalSeq");

-- CreateIndex
CREATE INDEX "PolicyCheck_actionId_idx" ON "PolicyCheck"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "EoaNonceReservation_actionId_key" ON "EoaNonceReservation"("actionId");

-- CreateIndex
CREATE INDEX "EoaNonceReservation_chainId_operator_status_idx" ON "EoaNonceReservation"("chainId", "operator", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAttempt_txHash_key" ON "TransactionAttempt"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAttempt_chainId_executor_contractNonce_key" ON "TransactionAttempt"("chainId", "executor", "contractNonce");

-- CreateIndex
CREATE INDEX "AttemptEvent_actionId_id_idx" ON "AttemptEvent"("actionId", "id");

-- CreateIndex
CREATE INDEX "RiskEvent_source_blockNumber_idx" ON "RiskEvent"("source", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_chainId_txHash_logIndex_key" ON "RiskEvent"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "ActivityEvent_ownerId_id_idx" ON "ActivityEvent"("ownerId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCaseResult_runId_personaId_key" ON "EvaluationCaseResult"("runId", "personaId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceRecord" ADD CONSTRAINT "PreferenceRecord_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Executor" ADD CONSTRAINT "Executor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "WalletIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "WalletIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "Executor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCheck" ADD CONSTRAINT "PolicyCheck_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ActionProposal"("actionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "WalletIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCaseResult" ADD CONSTRAINT "EvaluationCaseResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvaluationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exact-value and canonical-format constraints (Prisma cannot express these).
ALTER TABLE "AuthChallenge"
  ADD CONSTRAINT "AuthChallenge_address_address" CHECK ("address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "AuthChallenge_testnet_chain" CHECK ("chainId" = 84532);

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_ordinal_components" CHECK ("materiality" BETWEEN 0 AND 3 AND "uncertainty" BETWEEN 0 AND 3 AND "decisionFlip" BETWEEN 0 AND 3 AND "friction" BETWEEN 0 AND 3),
  ADD CONSTRAINT "Question_order_budget" CHECK ("order" BETWEEN 1 AND 5);

ALTER TABLE "Executor"
  ADD CONSTRAINT "Executor_address_address" CHECK ("address" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "Executor_factory_address" CHECK ("factory" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "Executor_testnet_chain" CHECK ("chainId" = 84532),
  ADD CONSTRAINT "Executor_verifiedAtBlock_uint256" CHECK ("verifiedAtBlock" >= 0 AND "verifiedAtBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);

ALTER TABLE "Mandate"
  ADD CONSTRAINT "Mandate_asset_address" CHECK ("asset" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "Mandate_operator_address" CHECK ("operator" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "Mandate_beneficiary_address" CHECK ("beneficiary" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "Mandate_testnet_chain" CHECK ("chainId" = 84532),
  ADD CONSTRAINT "Mandate_masks" CHECK ("allowedVaults" BETWEEN 1 AND 3 AND "allowedActions" BETWEEN 1 AND 3),
  ADD CONSTRAINT "Mandate_uint64_expiry" CHECK ("expiresAt" > 0 AND "expiresAt" <= 18446744073709551615),
  ADD CONSTRAINT "Mandate_uint32_lockup" CHECK ("maxLockupSeconds" >= 0 AND "maxLockupSeconds" <= 4294967295),
  ADD CONSTRAINT "Mandate_maxDepositPerAction_uint256" CHECK ("maxDepositPerAction" >= 0 AND "maxDepositPerAction" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "Mandate_maxCumulativeDeposits_uint256" CHECK ("maxCumulativeDeposits" >= 0 AND "maxCumulativeDeposits" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "Mandate_maxWithdrawPerAction_uint256" CHECK ("maxWithdrawPerAction" >= 0 AND "maxWithdrawPerAction" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "Mandate_allocationTarget_uint256" CHECK ("allocationTarget" >= 0 AND "allocationTarget" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "Mandate_onchainVersion_uint256" CHECK ("onchainVersion" IS NULL OR ("onchainVersion" >= 0 AND "onchainVersion" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)),
  ADD CONSTRAINT "Mandate_authorizedBlock_uint256" CHECK ("authorizedBlock" IS NULL OR ("authorizedBlock" >= 0 AND "authorizedBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)),
  ADD CONSTRAINT "Mandate_fundedAtBlock_uint256" CHECK ("fundedAtBlock" IS NULL OR ("fundedAtBlock" >= 0 AND "fundedAtBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)),
  ADD CONSTRAINT "Mandate_previewHash_hash" CHECK ("previewHash" IS NULL OR "previewHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "Mandate_mandateHash_hash" CHECK ("mandateHash" IS NULL OR "mandateHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "Mandate_authorizationTxHash_hash" CHECK ("authorizationTxHash" IS NULL OR "authorizationTxHash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "Decision"
  ADD CONSTRAINT "Decision_snapshotBlock_uint256" CHECK ("snapshotBlock" >= 0 AND "snapshotBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "Decision_snapshotBlockHash_hash" CHECK ("snapshotBlockHash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "ActionProposal"
  ADD CONSTRAINT "ActionProposal_actionId_hash" CHECK ("actionId" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "ActionProposal_executor_address" CHECK ("executor" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "ActionProposal_target_address" CHECK ("target" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "ActionProposal_testnet_chain" CHECK ("chainId" = 84532),
  ADD CONSTRAINT "ActionProposal_positive_amount" CHECK ("amount" > 0),
  ADD CONSTRAINT "ActionProposal_amount_uint256" CHECK ("amount" >= 0 AND "amount" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "ActionProposal_onchainVersion_uint256" CHECK ("onchainVersion" >= 0 AND "onchainVersion" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "ActionProposal_contractNonce_uint256" CHECK ("contractNonce" >= 0 AND "contractNonce" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "ActionProposal_deadline_uint256" CHECK ("deadline" >= 0 AND "deadline" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "ActionProposal_seq" CHECK ("proposalSeq" >= 0);

ALTER TABLE "EoaNonceReservation"
  ADD CONSTRAINT "EoaNonceReservation_operator_address" CHECK ("operator" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "EoaNonceReservation_actionId_hash" CHECK ("actionId" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "EoaNonceReservation_nonnegative_nonce" CHECK ("eoaNonce" >= 0);

ALTER TABLE "TransactionAttempt"
  ADD CONSTRAINT "TransactionAttempt_actionId_hash" CHECK ("actionId" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransactionAttempt_requestHash_hash" CHECK ("requestHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransactionAttempt_txHash_hash" CHECK ("txHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransactionAttempt_owner_address" CHECK ("owner" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "TransactionAttempt_executor_address" CHECK ("executor" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "TransactionAttempt_operator_address" CHECK ("operator" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "TransactionAttempt_contractNonce_uint256" CHECK ("contractNonce" >= 0 AND "contractNonce" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "TransactionAttempt_signedAtBlock_uint256" CHECK ("signedAtBlock" >= 0 AND "signedAtBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "TransactionAttempt_receiptBlockNumber_uint256" CHECK ("receiptBlockNumber" IS NULL OR ("receiptBlockNumber" >= 0 AND "receiptBlockNumber" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935)),
  ADD CONSTRAINT "TransactionAttempt_receiptBlockHash_hash" CHECK ("receiptBlockHash" IS NULL OR "receiptBlockHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransactionAttempt_nonnegative" CHECK ("eoaNonce" >= 0 AND "sendCount" >= 0);

ALTER TABLE "MonitorCursor"
  ADD CONSTRAINT "MonitorCursor_nextBlock_uint256" CHECK ("nextBlock" >= 0 AND "nextBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "MonitorCursor_previousBlockHash_hash" CHECK ("previousBlockHash" IS NULL OR "previousBlockHash" ~ '^0x[0-9a-f]{64}$');

ALTER TABLE "RiskEvent"
  ADD CONSTRAINT "RiskEvent_txHash_hash" CHECK ("txHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "RiskEvent_blockHash_hash" CHECK ("blockHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "RiskEvent_observedAtBlockHash_hash" CHECK ("observedAtBlockHash" ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "RiskEvent_source_address" CHECK ("source" ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT "RiskEvent_blockNumber_uint256" CHECK ("blockNumber" >= 0 AND "blockNumber" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "RiskEvent_observedAtBlock_uint256" CHECK ("observedAtBlock" >= 0 AND "observedAtBlock" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "RiskEvent_eventCapacity_uint256" CHECK ("eventCapacity" >= 0 AND "eventCapacity" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "RiskEvent_currentCapacity_uint256" CHECK ("currentCapacity" >= 0 AND "currentCapacity" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935),
  ADD CONSTRAINT "RiskEvent_levels" CHECK ("eventRiskLevel" IN (0, 1) AND "currentRiskLevel" IN (0, 1) AND "logIndex" >= 0);

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_positive_max_attempts" CHECK ("maxAttempts" > 0);

-- At most one authorized mandate per executor.
CREATE UNIQUE INDEX "Mandate_one_authorized_per_executor" ON "Mandate"("executorId") WHERE "status" = 'AUTHORIZED';

-- Contract action nonces are read from a confirmed snapshot, so actions for one executor must be
-- strictly serial: at most one non-terminal action at a time.
CREATE UNIQUE INDEX "ActionProposal_one_active_per_executor" ON "ActionProposal"("chainId", "executor")
  WHERE "state" IN ('ACTION_PROPOSED', 'POLICY_CHECKED', 'BROADCAST', 'RECONCILE');

-- An EOA nonce may be reused only after its reservation was released.
CREATE UNIQUE INDEX "EoaNonceReservation_active_nonce" ON "EoaNonceReservation"("chainId", "operator", "eoaNonce")
  WHERE "status" <> 'RELEASED';
