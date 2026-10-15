ALTER TABLE "Intent"
ADD CONSTRAINT "Intent_amount_uint256" CHECK (
  "amount" > 0 AND
  "amount" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
),
ADD CONSTRAINT "Intent_testnet_chain" CHECK ("chainId" = 84532);

ALTER TABLE "WalletIdentity"
ADD CONSTRAINT "WalletIdentity_canonical_address" CHECK ("address" ~ '^0x[0-9a-f]{40}$');

ALTER TABLE "Job"
ADD CONSTRAINT "Job_nonnegative_attempts" CHECK ("attempts" >= 0);
