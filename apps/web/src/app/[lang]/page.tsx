import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { ModeChooser } from './ModeChooser';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  return { title: serverT((await params).lang)('meta.home') };
}

/** Screen 1: landing + choice between "En studio" and "Virtuel". */
export default function HomePage() {
  return <ModeChooser />;
}
