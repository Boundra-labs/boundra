import type { Page } from '@playwright/test';
import { createWalletClient, hexToString, http, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { E2E_RPC_URL } from './chain';

export interface TestWalletOptions {
  /** Chain the wallet starts on (Base Sepolia by default). */
  chainId?: number;
  /** Decline every signature request, as if the owner pressed Reject. */
  rejectSignatures?: boolean;
  /** Decline every transaction request, as if the owner pressed Reject. */
  rejectTransactions?: boolean;
  /** Use a known key (e.g. a funded local anvil account) instead of a fresh random one. */
  privateKey?: Hex;
  /** RPC the wallet sends transactions to and forwards reads to. */
  rpc?: string;
}

interface WalletTransaction {
  to?: Address;
  data?: Hex;
  value?: Hex;
  gas?: Hex;
}

/**
 * Installs an EIP-1193 browser wallet backed by a throwaway key, so E2E tests can connect,
 * switch networks, sign in and send transactions without an extension. Signing happens in the
 * test process; the key never enters the page. Like MetaMask, it forwards read-only requests to
 * its RPC.
 */
export async function installTestWallet(page: Page, options: TestWalletOptions = {}) {
  const account = privateKeyToAccount(options.privateKey ?? generatePrivateKey());
  const rpc = options.rpc ?? E2E_RPC_URL;
  const sender = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
  let signRequests = 0;
  let transactionRequests = 0;
  await page.exposeFunction('__testWalletSign', async (messageHex: string) => {
    signRequests++;
    if (options.rejectSignatures) return null;
    return account.signMessage({ message: hexToString(messageHex as Hex) });
  });
  await page.exposeFunction('__testWalletSend', async (tx: WalletTransaction) => {
    transactionRequests++;
    if (options.rejectTransactions) return null;
    return sender.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    });
  });
  await page.addInitScript(
    ({ address, chainId, rpc }) => {
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
      const bridge = window as unknown as {
        __testWalletSign: (m: string) => Promise<string | null>;
        __testWalletSend: (tx: unknown) => Promise<string | null>;
      };
      let rpcId = 0;
      const forward = async (method: string, params: unknown[] = []) => {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
        });
        const body = (await response.json()) as { result?: unknown; error?: unknown };
        if (body.error) throw Object.assign(new Error('RPC error'), body.error);
        return body.result;
      };

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
              const signature = await bridge.__testWalletSign(params?.[0] as string);
              if (!signature) throw rejected();
              return signature;
            }
            case 'eth_sendTransaction': {
              const hash = await bridge.__testWalletSend(params?.[0]);
              if (!hash) throw rejected();
              return hash;
            }
            default:
              if (method.startsWith('eth_')) return forward(method, params);
              throw Object.assign(new Error(`Unsupported test wallet method ${method}`), {
                code: 4200,
              });
          }
        },
      };
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
    },
    { address: account.address, chainId: options.chainId ?? 84532, rpc },
  );
  return {
    address: account.address,
    signRequests: () => signRequests,
    transactionRequests: () => transactionRequests,
  };
}
