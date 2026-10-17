import { isApiError } from './api';

interface ErrorLike {
  name?: string;
  code?: number;
  message?: string;
  shortMessage?: string;
  cause?: unknown;
}

/** viem/wagmi wrap provider errors; walk the cause chain for the name or EIP-1193 code. */
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current = error;
  while (current && typeof current === 'object' && out.length < 8) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

const has = (error: unknown, test: (e: ErrorLike) => boolean) => chain(error).some(test);

export const isUserRejection = (error: unknown) =>
  has(error, (e) => e.name === 'UserRejectedRequestError' || e.code === 4001);

/** A short, user-facing explanation of why a wallet request did not complete. */
export function walletErrorMessage(error: unknown, action: string): string {
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  if (isUserRejection(error))
    return `You declined the request in your wallet, so nothing was ${action}.`;
  if (has(error, (e) => e.name === 'ProviderNotFoundError'))
    return 'No browser wallet was found. Install or enable a wallet extension such as MetaMask, then try again.';
  if (has(error, (e) => e.code === -32002))
    return 'Your wallet already has a request open. Finish or close it in the wallet, then try again.';
  if (has(error, (e) => e.name === 'SwitchChainNotSupportedError'))
    return 'This wallet cannot switch networks from the app. Switch to Base Sepolia in the wallet itself.';
  // Anything else: keep the wallet's own reason visible (and the full error in the console), so
  // an owner or developer can act on it instead of retrying blindly.
  console.warn('Wallet request failed', error);
  const reason = walletReason(error);
  return `Your wallet could not complete this, so nothing was ${action}.${reason ? ` It said: “${reason}”.` : ''} Try again.`;
}

/** The most specific short reason a provider gave, without viem's request dump. */
function walletReason(error: unknown): string | undefined {
  const generic = /^(An unknown error occurred|Internal JSON-RPC error)\.?$/i;
  for (const e of chain(error).reverse()) {
    const text = (e.shortMessage ?? e.message ?? '').split('\n')[0]!.trim();
    if (text && !generic.test(text)) return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  }
  return undefined;
}
