import type { Page } from '@playwright/test';
import { hexToString, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export interface TestWalletOptions {
  /** Chain the wallet starts on (Base Sepolia by default). */
  chainId?: number;
  /** Decline every signature request, as if the owner pressed Reject. */
  rejectSignatures?: boolean;
}

/**
 * Installs an EIP-1193 browser wallet backed by a throwaway key, so E2E tests can connect,
 * switch networks and sign in without an extension. Signing happens in the test process; the
 * key never enters the page.
 */
export async function installTestWallet(page: Page, options: TestWalletOptions = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  let signRequests = 0;
  await page.exposeFunction('__testWalletSign', async (messageHex: string) => {
    signRequests++;
    if (options.rejectSignatures) return null;
    return account.signMessage({ message: hexToString(messageHex as Hex) });
  });
  await page.addInitScript(
    ({ address, chainId }) => {
      // Like a real extension, the wallet remembers this site's authorization and its network
      // across reloads (per tab).
      const saved = JSON.parse(sessionStorage.getItem('__testWallet') ?? 'null') as {
        chain: number;
        connected: boolean;
      } | null;
      let chain = saved?.chain ?? chainId;
      let connected = saved?.connected ?? false;
      const save = () =>
        sessionStorage.setItem('__testWallet', JSON.stringify({ chain, connected }));
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const emit = (event: string, value: unknown) =>
        listeners.get(event)?.forEach((listener) => listener(value));
      const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });
      const hex = (value: number) => `0x${value.toString(16)}`;

      const provider = {
        isMetaMask: true,
        on(event: string, listener: (value: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
        },
        removeListener(event: string, listener: (value: unknown) => void) {
          listeners.get(event)?.delete(listener);
        },
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case 'eth_requestAccounts':
              connected = true;
              save();
              return [address];
            case 'eth_accounts':
              return connected ? [address] : [];
            case 'eth_chainId':
              return hex(chain);
            case 'net_version':
              return String(chain);
            case 'wallet_requestPermissions':
              connected = true;
              save();
              return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_revokePermissions':
              connected = false;
              save();
              return null;
            case 'wallet_switchEthereumChain': {
              chain = Number.parseInt((params?.[0] as { chainId: string }).chainId, 16);
              save();
              emit('chainChanged', hex(chain));
              return null;
            }
            case 'personal_sign': {
              const signature = await (
                window as unknown as { __testWalletSign: (m: string) => Promise<string | null> }
              ).__testWalletSign(params?.[0] as string);
              if (!signature) throw rejected();
              return signature;
            }
            default:
              throw Object.assign(new Error(`Unsupported test wallet method ${method}`), {
                code: 4200,
              });
          }
        },
      };
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
    },
    { address: account.address, chainId: options.chainId ?? 84532 },
  );
  return { address: account.address, signRequests: () => signRequests };
}
