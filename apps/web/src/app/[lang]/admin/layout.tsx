import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { serverT } from '@/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const title = serverT((await params).lang)('adminAuth.meta');
  return {
    title: { default: title, template: `%s · ${title} Bovann` },
    // The admin area must never appear in search engines.
    robots: { index: false, follow: false },
  };
}

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
