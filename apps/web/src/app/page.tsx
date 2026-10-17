import { LivingBoundary } from '@/components/landing/living-boundary';
import {
  Clarify,
  Closing,
  EvidenceSection,
  Hero,
  Journey,
  MandateSection,
  SiteFooter,
} from '@/components/landing/sections';
import { SiteNav } from '@/components/landing/site-nav';
import '@/components/landing/landing.css';

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#journey">
        Skip to how it works
      </a>
      <SiteNav />
      <main>
        <LivingBoundary>
          <Hero />
          <Journey />
          <Clarify />
          <MandateSection />
          <EvidenceSection />
          <Closing />
        </LivingBoundary>
      </main>
      <SiteFooter />
    </>
  );
}
