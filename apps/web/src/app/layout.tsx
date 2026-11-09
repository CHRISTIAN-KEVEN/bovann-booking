import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import { FlowProvider } from '@/components/FlowProvider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Bovann OCD Live — Réservation de studio live',
    template: '%s · Bovann OCD Live',
  },
  description:
    'Réservez votre session live au studio Bovann OCD Live à Lomé, en studio ou en virtuel. Créneaux de 1h30 et forfaits avantageux.',
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
