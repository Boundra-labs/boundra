'use client';

import { AccessGate } from './access-gate';
import { AppShell } from './app-shell';
import { shortAddress } from './format';

export function OwnerApp() {
  return (
    <AppShell>
      <AccessGate>
        {(session) => (
          <section className="gate-card" aria-labelledby="home-heading">
            <p className="gate-eyebrow">Signed in · Base Sepolia</p>
            <h1 id="home-heading" className="gate-title">
              Welcome, {shortAddress(session.address)}
            </h1>
            <p className="gate-lede">
              Your session is active. Setting a goal and reviewing a mandate come next; nothing has
              been approved or funded.
            </p>
          </section>
        )}
      </AccessGate>
    </AppShell>
  );
}
