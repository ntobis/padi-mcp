import type { ReactNode } from 'react';

export const metadata = {
  title: 'PADI MCP',
  description: 'Managed PADI logbook MCP service',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
