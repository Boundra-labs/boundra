/**
 * Person 1's generated ABIs. They are imported file by file: the package root also exports the
 * Node-only manifest loader, which must not reach the browser bundle.
 */
import { boundraFactoryAbi } from '@boundra/chain/dist/abis/BoundraFactory';
import { mockUSDCAbi } from '@boundra/chain/dist/abis/MockUSDC';
import { mockUSDCFaucetAbi } from '@boundra/chain/dist/abis/MockUSDCFaucet';

export { boundraFactoryAbi as factoryAbi };
export { mockUSDCAbi as tokenAbi };

/** `claim()` mints through the token, so its errors (e.g. SupplyCapExceeded) can surface too. */
export const faucetAbi = [
  ...mockUSDCFaucetAbi,
  ...mockUSDCAbi.filter((item) => item.type === 'error'),
] as const;
