import type { Metadata, Viewport } from 'next';
import { Newsreader, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' });
const serif = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  axes: ['opsz'],
});

export const metadata: Metadata = {
  title: 'Boundra | Autonomy within your boundaries',
  description: 'A risk-aligned autonomous agent wallet. Base Sepolia prototype.',
};

export const viewport: Viewport = { themeColor: '#f6f8f2' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
