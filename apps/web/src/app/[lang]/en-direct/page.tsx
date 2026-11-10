import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { LiveWall } from './LiveWall';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const t = serverT((await params).lang);
  return { title: t('lives.metaTitle'), description: t('lives.metaDescription') };
}

/** "En direct": the wall of sellers live on TikTok and Facebook right now. */
export default function LivesPage() {
  return <LiveWall />;
}
