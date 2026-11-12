import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { PassPurchase } from './PassPurchase';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const t = serverT((await params).lang);
  return { title: t('pay.passPage'), robots: { index: false } };
}

/** A seller buys (or extends) a monthly or annual pass. */
export default function PassPage() {
  return <PassPurchase />;
}
