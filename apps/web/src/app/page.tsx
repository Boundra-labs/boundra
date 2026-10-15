import { WalletButton } from '@/components/wallet-button';
import { ServiceStatus } from '@/components/service-status';

const steps = [
  ['01', 'Define your goal', 'Tell Boundra what you want to manage and what matters to you.'],
  [
    '02',
    'Set your boundaries',
    'Clarify the tradeoffs, then review and approve an explicit mandate.',
  ],
  [
    '03',
    'Delegate with visibility',
    'Follow permitted actions, risk responses and verifiable receipts.',
  ],
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <a className="brand" href="/" aria-label="Boundra home">
          <span className="brand-mark" aria-hidden="true">
            b.
          </span>
          boundra<span className="badge">TESTNET</span>
        </a>
        <WalletButton />
      </header>
      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot online" /> YOUR INTENT. YOUR AUTHORITY.
        </div>
        <h1>
          Autonomy within
          <br />
          your <span>boundaries.</span>
        </h1>
        <p className="intro">
          An agent wallet that understands your constraints before it acts. Clear permissions.
          Bounded execution. A trail you can verify.
        </p>
        <div className="prototype-label">
          Prototype foundation <span>·</span> Asset management is coming next
        </div>
        <ServiceStatus />
      </section>
      <section className="journey" aria-labelledby="journey-heading">
        <div className="section-heading">
          <h2 id="journey-heading">A clear path from intent to action.</h2>
          <span>THE BOUNDRA WORKFLOW</span>
        </div>
        <div className="step-grid">
          {steps.map(([number, title, description]) => (
            <article className="step" key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="planned">Planned</span>
            </article>
          ))}
        </div>
      </section>
      <aside className="notice">
        <span className="notice-symbol" aria-hidden="true">
          ↗
        </span>
        <div>
          <strong>Built for Base Sepolia.</strong>
          <p>
            This prototype uses MockUSDC and mock vaults. No real funds or investment returns.
            Connecting a wallet does not authorize asset movement.
          </p>
        </div>
      </aside>
      <footer>
        <span>BOUNDRA / FINTECHATHON 2026</span>
        <span>Intent → Mandate → Action → Evidence</span>
      </footer>
    </main>
  );
}
