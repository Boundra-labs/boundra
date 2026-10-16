import type { CSSProperties, ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { ServiceStatus } from '@/components/service-status';
import { WalletButton } from '@/components/wallet-button';
import { ClarifyBranch } from './clarify-branch';
import { EvidenceTrace } from './evidence-trace';
import {
  Alert,
  ArrowDown,
  ArrowRight,
  Card,
  Check,
  Document,
  Hand,
  List,
  Minus,
  Pause,
  Person,
  Sliders,
  Stop,
} from './icons';
import { IntentField } from './intent-field';
import { Mascot } from './mascot';
import { RibbonAnchor } from './ribbon-anchor';
import { ClosingScene, EvidenceScene, ForestEdge, HeroScene, MistScene } from './scenery';

const delay = (index: number) => ({ '--d': index }) as CSSProperties;

export function Hero() {
  return (
    <section id="top" className="hero" aria-labelledby="hero-heading">
      <HeroScene />
      <div className="shell hero-inner">
        <RibbonAnchor order={100} x="-24%" y="84%" only="desktop" />
        <RibbonAnchor order={170} x="100%" y="47%" only="desktop" />
        <RibbonAnchor order={215} x="105%" y="100%" dir="v" only="desktop" />

        <RibbonAnchor order={100} x="0" y="0" mx="106%" my="4%" only="mobile" />
        <RibbonAnchor order={140} x="0" y="0" mx="94%" my="84%" dir="v" only="mobile" glintEnd />
        <RibbonAnchor order={150} x="0" y="0" mx="60%" my="98%" dir="h" only="mobile" />

        <div className="hero-copy">
          <h1 id="hero-heading" className="hero-title">
            <span className="title-line">Autonomy</span>{' '}
            <span className="title-line">that knows</span>{' '}
            <span className="title-line">
              where to stop<span className="lime-dot">.</span>
            </span>
          </h1>
          <p className="hero-lede">
            Tell Boundra your goal. Define the limits.
            <br />
            Keep the authority.
          </p>
          <div className="hero-actions">
            <a className="button button-lg" href="#intent">
              Create your mandate <ArrowRight className="button-arrow" />
            </a>
            <a className="link-arrow" href="#journey">
              Explore the flow <ArrowRight />
            </a>
          </div>
          <IntentField />
        </div>

        <div className="hero-mascot" data-ambient>
          {/* The ribbon passes through the ring right to left, then swings in one wide loop
              under the mascot to the "Take action" landmark. */}
          <RibbonAnchor order={180} x="92%" y="70%" dir="h" only="desktop" />
          <RibbonAnchor order={190} x="10%" y="70%" dir="h" only="desktop" />
          <RibbonAnchor order={195} x="-34%" y="113%" dir="v" only="desktop" />
          <RibbonAnchor order={110} x="0" y="0" mx="52%" my="78%" dir="v" only="mobile" />
          <Mascot id="hero" pose="guide" className="mascot-arrive" />
        </div>

        <ul className="hero-landmarks" aria-label="What a mandate does">
          <li className="landmark landmark-limits">
            <RibbonAnchor order={150} x="22%" y="calc(100% + 46px)" only="desktop" />
            <span className="landmark-icon">
              <Sliders />
            </span>
            <span>
              <strong>Set your limits</strong>
              <small>Stay within your rules</small>
            </span>
          </li>
          <li className="landmark landmark-bounds">
            <RibbonAnchor order={160} x="22%" y="calc(100% + 46px)" dir="h" only="desktop" />
            <span className="landmark-icon">
              <Minus />
            </span>
            <span>
              <strong>Define boundaries</strong>
              <small>Block what you don’t want</small>
            </span>
          </li>
          <li className="landmark landmark-action">
            <RibbonAnchor
              order={205}
              x="22%"
              y="calc(100% + 46px)"
              dir="h"
              only="desktop"
              glintEnd
            />
            <span className="landmark-icon landmark-icon-lime">
              <Check />
            </span>
            <span>
              <strong>Take action</strong>
              <small>See verifiable evidence</small>
            </span>
          </li>
        </ul>

        <a className="scroll-cue" href="#journey" aria-label="Scroll to how it works">
          <ArrowDown />
        </a>
      </div>
    </section>
  );
}

const moments = [
  ['Intent', 'Tell Boundra what to manage and how much.'],
  ['Boundaries', 'Answer only what changes the action.'],
  ['Action', 'Approve an explicit mandate. The agent acts inside it.'],
  ['Evidence', 'Every decision keeps its real status.'],
] as const;

const landmarks: [ReactNode, string, string][] = [
  [
    <Person key="p" />,
    'Owner controlled',
    'Only you can authorize, replace, pause or revoke a mandate.',
  ],
  [<Sliders key="s" />, 'Budget capped', 'Every action stays within the amount you approved.'],
  [<List key="l" />, 'Targets allowlisted', 'The agent can only use reviewed targets and actions.'],
  [
    <Document key="d" />,
    'Evidence you can verify',
    'On-chain actions carry real status and receipts.',
  ],
];

export function Journey() {
  return (
    <section id="journey" className="journey" aria-labelledby="journey-heading">
      <MistScene id="journey-mist" />
      <div className="shell rail journey-inner">
        <RibbonAnchor order={300} x="60%" y="3%" dir="h" only="desktop" />
        <RibbonAnchor order={310} x="1.5%" y="20.5%" dir="v" only="desktop" />
        <RibbonAnchor order={305} x="0" y="0" mx="24px" my="0%" dir="v" only="mobile" />

        <h2 id="journey-heading" className="eyebrow journey-eyebrow">
          How Boundra works
        </h2>
        <ol className="moments">
          {moments.map(([word, caption], index) => (
            <li key={word} className="moment" data-reveal style={delay(index)}>
              <span className="moment-word">
                {word}
                {index < moments.length - 1 && (
                  <ArrowRight className="moment-arrow" aria-hidden="true" />
                )}
              </span>
              <span className="moment-track">
                <RibbonAnchor order={320 + index} x="50%" y="50%" dir="h" only="desktop" />
              </span>
              <span className="moment-caption">{caption}</span>
            </li>
          ))}
        </ol>

        <RibbonAnchor order={340} x="104%" y="38%" dir="v" only="desktop" />
        <RibbonAnchor order={345} x="45%" y="51%" dir="h" only="desktop" />
        <RibbonAnchor order={350} x="-2.5%" y="63%" dir="v" only="desktop" />

        <ul className="trust" aria-label="Trust principles">
          {landmarks.map(([icon, title, text], index) => (
            <li key={title} className="trust-item" data-reveal style={delay(index)}>
              <span className="trust-node">
                <RibbonAnchor order={360 + index} x="50%" y="50%" />
                {icon}
              </span>
              <span className="trust-text">
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <RibbonAnchor order={390} x="98%" y="96%" only="desktop" />
      </div>
    </section>
  );
}

export function Clarify() {
  return (
    <section id="clarify" className="clarify" aria-label="Clarification">
      <MistScene id="clarify-mist" flip />
      <div className="shell rail">
        <RibbonAnchor order={400} x="0" y="0" mx="24px" my="0%" dir="v" only="mobile" />
        <RibbonAnchor order={430} x="0" y="0" mx="24px" my="100%" dir="v" only="mobile" />
        <ClarifyBranch />
      </div>
    </section>
  );
}

const mandateRows: [string, ReactNode][] = [
  ['Owner', 'Your wallet'],
  ['Operator', 'Boundra agent · reviewed address'],
  ['Chain', 'Base Sepolia · 84532'],
  ['Token', 'MockUSDC'],
  [
    'Target',
    <>
      LiquidVault <em className="ok">eligible</em>
    </>,
  ],
  ['Actions', 'Deposit · Withdraw'],
  ['Beneficiary', 'Your wallet'],
  ['Per-action limit', '100 MockUSDC'],
  ['Cumulative budget', '300 MockUSDC'],
  ['Maximum lockup', 'None'],
  ['Expiry', '7 days after approval · editable before you approve'],
  ['Version', 'Assigned when you sign'],
];

export function MandateSection() {
  return (
    <section id="mandate" className="mandate" aria-labelledby="mandate-heading">
      <div className="shell rail mandate-grid">
        <RibbonAnchor order={500} x="0" y="0" mx="24px" my="0%" dir="v" only="mobile" />
        <RibbonAnchor order={520} x="0" y="0" mx="24px" my="100%" dir="v" only="mobile" />
        <div className="mandate-copy" data-reveal>
          <p className="eyebrow">Mandate</p>
          <h2 id="mandate-heading" className="display">
            Your mandate, in plain sight.
          </h2>
          <p className="lede">
            A clear, human-readable plan that turns your intent into explicit limits. Nothing is
            active until you approve it and the chain confirms it.
          </p>
          <ul className="mandate-points">
            <li>
              <Check /> You stay the owner and the beneficiary.
            </li>
            <li>
              <Check /> Budget, targets and expiry are enforced on-chain.
            </li>
            <li>
              <Check /> Pause, replace or revoke at any time.
            </li>
          </ul>
        </div>

        <div className="sheet-wrap">
          <RibbonAnchor order={510} x="50%" y="60%" only="desktop" />
          <RibbonAnchor order={520} x="104%" y="94%" only="desktop" />
          <article className="sheet" aria-labelledby="sheet-title" data-reveal>
            <header className="sheet-head">
              <span className="sheet-title" id="sheet-title">
                <Document /> Your mandate
              </span>
              <span className="chip">Example preview</span>
            </header>
            <p className="sheet-state">
              <span className="state-dot" aria-hidden="true" /> Draft · not authorized
            </p>
            <dl className="sheet-rows">
              {mandateRows.map(([label, value], index) => (
                <div key={label} className="sheet-row" data-reveal style={delay(index)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <footer className="sheet-foot">
              <p>Values are illustrative. Your own preview uses live data before you approve.</p>
              <a className="button" href="#intent">
                Start with your goal <ArrowRight className="button-arrow" />
              </a>
            </footer>
          </article>
        </div>
      </div>
      <ForestEdge />
    </section>
  );
}

const otherOutcomes: [ReactNode, string, string][] = [
  [<Pause key="h" />, 'Hold', 'No action needed · no transaction'],
  [<Hand key="e" />, 'Escalate', 'Waiting for you · no transaction'],
  [<Stop key="r" />, 'Rejected', 'Stopped before broadcast'],
];

export function EvidenceSection() {
  return (
    <section id="evidence" className="evidence" aria-labelledby="evidence-heading">
      <EvidenceScene />
      <div className="shell rail evidence-grid">
        <RibbonAnchor order={590} x="62%" y="-2%" mx="24px" my="0%" dir="v" />
        <div className="evidence-copy" data-reveal>
          <p className="eyebrow eyebrow-dark">Evidence</p>
          <h2 id="evidence-heading" className="display">
            Every action leaves evidence.
          </h2>
          <p className="lede">
            From policy check to on-chain confirmation, every step is recorded with its real status.
            Only real transactions carry a hash and an explorer link.
          </p>
          <ul className="outcomes" aria-label="Outcomes that never get a success trace">
            {otherOutcomes.map(([icon, title, text]) => (
              <li key={title}>
                <span className="outcome-icon">{icon}</span>
                <strong>{title}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <aside className="testnet-card" aria-label="Testnet disclosure">
            <p className="testnet-title">
              <Card /> TESTNET ONLY
            </p>
            <p className="testnet-tags">Base Sepolia · MockUSDC · Mock vaults</p>
            <p>
              No real funds or investment returns. Connecting a wallet does not authorize asset
              movement.
            </p>
          </aside>
        </div>
        <EvidenceTrace />
        <RibbonAnchor ribbon="return" order={10} x="80%" y="100%" mx="24px" my="100%" dir="v" />
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-heading">
      <ClosingScene />
      <div className="shell rail closing-inner">
        <RibbonAnchor ribbon="return" order={20} x="60%" y="26%" mx="24px" my="8%" dir="v" />
        <RibbonAnchor ribbon="return" order={30} x="56%" y="70%" mx="24px" my="52%" dir="v" />
        <RibbonAnchor ribbon="return" order={40} x="73%" y="112%" dir="h" only="desktop" />
        <RibbonAnchor ribbon="return" order={50} x="96%" y="88%" dir="v" only="desktop" />
        <div className="closing-copy" data-reveal>
          <h2 id="closing-heading" className="display">
            Ready to define your boundaries?
          </h2>
          <p className="lede">
            Turn your intent into a clear mandate and keep autonomous actions on rails.
          </p>
          <WalletButton />
          <p className="closing-note">
            <Alert /> Connecting only identifies your wallet. It never approves a mandate or moves
            funds.
          </p>
        </div>
        <div className="closing-mascot" data-ambient data-reveal>
          {/* Desktop curls round and enters the ring from the right; a phone has no room for
              the curl, so there the ribbon sweeps in from the left guide instead. */}
          <RibbonAnchor ribbon="return" order={60} x="92%" y="70%" dir="h" only="desktop" />
          <RibbonAnchor ribbon="return" order={70} x="8%" y="70%" dir="h" only="desktop" />
          <RibbonAnchor
            ribbon="return"
            order={60}
            x="0"
            y="0"
            mx="8%"
            my="70%"
            dir="h"
            only="mobile"
          />
          <RibbonAnchor
            ribbon="return"
            order={70}
            x="0"
            y="0"
            mx="92%"
            my="70%"
            dir="h"
            only="mobile"
          />
          <Mascot id="closing" pose="neutral" />
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <span className="brand brand-sm">
          <BrandMark className="brand-mark" />
          <span className="wordmark wordmark-sm">boundra</span>
        </span>
        <ServiceStatus />
        <span>Intent → Mandate → Action → Evidence</span>
        <span>BOUNDRA / FINTECHATHON 2026</span>
      </div>
    </footer>
  );
}
