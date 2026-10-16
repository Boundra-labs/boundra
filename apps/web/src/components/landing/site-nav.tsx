'use client';

import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { WalletButton } from '@/components/wallet-button';

const links = [
  { id: 'journey', label: 'How it works' },
  { id: 'mandate', label: 'Safety' },
  { id: 'evidence', label: 'Evidence' },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    // A section becomes active only once it fills the primary reading area.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
          else setActive((current) => (current === entry.target.id ? null : current));
        }
      },
      { rootMargin: '-38% 0px -52% 0px' },
    );
    for (const { id } of links) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`nav${scrolled || open ? ' is-floating' : ''}`}>
      <div className="nav-bar">
        <a className="brand" href="#top" aria-label="Boundra home">
          <BrandMark className="brand-mark" />
          <span className="wordmark">boundra</span>
        </a>
        <span className="testnet-badge">TESTNET</span>
        <nav className="nav-links" aria-label="Primary">
          {links.map(({ id, label }) => (
            <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-wallet">
          <WalletButton />
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="mobile-menu">
          <nav aria-label="Mobile">
            {links.map(({ id, label }) => (
              <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
          </nav>
          <WalletButton />
          <p className="mobile-menu-note">
            Base Sepolia · Mock assets only. Connecting a wallet does not authorize asset movement.
          </p>
        </div>
      )}
    </header>
  );
}
