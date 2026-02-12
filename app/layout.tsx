import type { Metadata } from 'next';
import { Playfair_Display, Manrope } from 'next/font/google';
import { APP_NAME } from '@/lib/constants';
import './globals.css';

export const runtime = 'edge';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-lux',
  display: 'swap',
  style: ['normal', 'italic'],
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'P&L and forecast management for agency',
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.ico',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${manrope.variable}`}>
      <body>
        <div className="noise-overlay" aria-hidden />
        <div className="min-h-full flex flex-col justify-start items-stretch">{children}</div>
      </body>
    </html>
  );
}
