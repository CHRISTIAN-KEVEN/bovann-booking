import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import { FlowProvider } from '@/components/FlowProvider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'OCD Live — Réservez votre live à Lomé',
    template: '%s · OCD Live',
  },
  description:
    'Passez en direct, on s’occupe du plateau. Réservez votre live shopping au studio OCD Live de Bovann à Lomé, en studio ou en virtuel. Paiement Mobile Money ou carte.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14151b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <FlowProvider>{children}</FlowProvider>
      </body>
    </html>
  );
}
