import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'PADI MCP — connect your dive logbook',
  description: 'Securely connect your PADI dive logbook to Claude via the managed MCP service.',
};

export const viewport = {
  themeColor: '#063763',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
