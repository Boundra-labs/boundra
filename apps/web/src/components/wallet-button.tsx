'use client';

import { injected, useConnect, useConnection, useDisconnect } from 'wagmi';

export function WalletButton() {
  const connection = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  return (
    <div className="wallet-area">
      {connection.isConnected ? (
        <>
          <button className="button secondary" onClick={() => disconnect.mutate()}>
            {connection.address?.slice(0, 6)}…{connection.address?.slice(-4)} · Disconnect
          </button>
          <span className="wallet-note">
            {connection.chainId === 84532
              ? 'Connected · Base Sepolia'
              : 'Switch your wallet to Base Sepolia'}
          </span>
        </>
      ) : (
        <button
          className="button"
          disabled={connect.isPending}
          onClick={() => connect.mutate({ connector: injected() })}
        >
          {connect.isPending ? 'Connecting…' : 'Connect wallet'} <span aria-hidden="true">↗</span>
        </button>
      )}
      {connect.error && (
        <span role="alert" className="wallet-note">
          Could not connect. Check your browser wallet and try again.
        </span>
      )}
    </div>
  );
}
