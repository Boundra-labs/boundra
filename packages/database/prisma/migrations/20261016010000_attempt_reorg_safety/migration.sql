-- A mined revert consumes the operator EOA nonce but leaves the executor contract nonce
-- unchanged. Release that tuple for a later action, while retaining confirmed attempts
-- so a receipt reorg cannot race a second live attempt for the same contract nonce.
DROP INDEX "TransactionAttempt_chainId_executor_contractNonce_key";

CREATE UNIQUE INDEX "TransactionAttempt_chainId_executor_contractNonce_live_key"
  ON "TransactionAttempt"("chainId", "executor", "contractNonce")
  WHERE "state" <> 'REVERTED';
