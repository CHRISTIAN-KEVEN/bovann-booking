import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import { FlowProvider } from '@/components/FlowProvider';
import { LOCALES, isLocale } from '@/i18n/config';
import { I18nProvider } from '@/i18n/I18nProvider';
import { MESSAGES } from '@/i18n/messages';
import { serverT } from '@/i18n/server';
import '../globals.css';

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const t = serverT(lang);
  return {
    title: { default: t('meta.title'), template: '%s · OCD Live' },
    description: t('meta.description'),
    alternates: { languages: { fr: '/', en: '/en' } },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14151b',
};

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html lang={lang}>
      <body>
        <I18nProvider locale={lang} messages={MESSAGES[lang]}>
          <FlowProvider>{children}</FlowProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
