import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { PostLive } from './PostLive';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const t = serverT((await params).lang);
  return { title: t('post.metaTitle'), robots: { index: false } };
}

/** "Publier mon live": signed-in sellers send their live for review. */
export default function PostLivePage() {
  return <PostLive />;
}
