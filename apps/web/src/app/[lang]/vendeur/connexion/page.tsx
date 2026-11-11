import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { SellerSignIn } from './SellerSignIn';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const t = serverT((await params).lang);
  return { title: t('seller.metaTitle'), robots: { index: false } };
}

/** Seller sign-in: phone number, then a code sent by WhatsApp or SMS. */
export default function SellerSignInPage() {
  return <SellerSignIn />;
}
