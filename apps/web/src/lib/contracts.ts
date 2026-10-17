/**
 * Person 1's generated ABIs and mandate helpers. They are imported file by file: the package root
 * also exports the Node-only manifest loader, which must not reach the browser bundle.
 */
import { boundraExecutorAbi } from '@boundra/chain/dist/abis/BoundraExecutor';
import { boundraFactoryAbi } from '@boundra/chain/dist/abis/BoundraFactory';
import { liquidVaultAbi } from '@boundra/chain/dist/abis/LiquidVault';
import { mockUSDCAbi } from '@boundra/chain/dist/abis/MockUSDC';
import { mockUSDCFaucetAbi } from '@boundra/chain/dist/abis/MockUSDCFaucet';

export { hashMandate, sameMandate, toMandateStruct } from '@boundra/chain/dist/mandate';
export { boundraFactoryAbi as factoryAbi };

const tokenErrors = mockUSDCAbi.filter((item) => item.type === 'error');

/** Both vaults share these errors (e.g. PositionLocked, InsufficientCapacity). */
const vaultErrors = liquidVaultAbi.filter(
  (item) =>
    item.type === 'error' &&
    ![...tokenErrors, ...boundraExecutorAbi].some(
      (known) => known.type === 'error' && known.name === item.name,
    ),
);

/**
 * The token's and vaults' errors are included so a failed transfer inside `fund`, or a vault
 * refusing `ownerWithdraw`, decodes too.
 */
export const executorAbi = [...boundraExecutorAbi, ...tokenErrors, ...vaultErrors] as const;
export { mockUSDCAbi as tokenAbi };

/** `claim()` mints through the token, so its errors (e.g. SupplyCapExceeded) can surface too. */
export const faucetAbi = [...mockUSDCFaucetAbi, ...tokenErrors] as const;
