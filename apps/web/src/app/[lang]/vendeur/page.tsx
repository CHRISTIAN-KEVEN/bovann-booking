import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { SellerHome } from './SellerHome';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const t = serverT((await params).lang);
  return { title: t('seller.homeTitle'), robots: { index: false } };
}

export default function SellerHomePage() {
  return <SellerHome />;
}
