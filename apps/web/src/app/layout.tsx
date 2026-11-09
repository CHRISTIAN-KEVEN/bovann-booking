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
    'Votre produit en direct devant toute l’Afrique. Réservez votre live au studio OCD Live de Bovann à Lomé, en studio ou à distance. Lives de 1h30, paiement Mobile Money.',
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
