import type { Metadata } from 'next';
import { ModeChooser } from './ModeChooser';

export const metadata: Metadata = { title: 'Réservez votre session live' };

/** Screen 1: landing + choice between "En studio" and "Virtuel". */
export default function HomePage() {
  return <ModeChooser />;
}
