import type { Metadata } from 'next';
import { serverT } from '@/i18n/server';
import { MyBookings } from './MyBookings';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  return { title: serverT((await params).lang)('meta.find') };
}

export default function MyBookingsPage() {
  return <MyBookings />;
}
