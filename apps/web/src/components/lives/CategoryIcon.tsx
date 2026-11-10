import type { CategoryIcon as CategoryIconName } from '@bovann/shared';
import type { ReactNode } from 'react';

/** Line icons for business categories: people who read little find their category by its picture. */
const PATHS: Record<CategoryIconName, ReactNode> = {
  mode: (
    <>
      <path d="M12 7.5a2 2 0 1 1 2.2-2c0 1-.8 1.4-1.4 1.8-.5.3-.8.7-.8 1.3V9" />
      <path d="M12 9 3.4 15.6c-.8.6-.4 1.9.6 1.9h16c1 0 1.4-1.3.6-1.9L12 9Z" />
    </>
  ),
  beaute: (
    <>
      <path d="M9 21h6v-8H9z" />
      <path d="M10 13V7.5L14 5v8" />
      <path d="M8 21h8" />
    </>
  ),
  food: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0Z" />
      <path d="M8 8c0-1.4 1-1.8 1-3.2M12 8c0-1.4 1-1.8 1-3.2M16 8c0-1.4 1-1.8 1-3.2" />
    </>
  ),
  elec: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  maison: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  sante: (
    <>
      <path d="M20.5 9c0 5-8.5 11-8.5 11S3.5 14 3.5 9a4.6 4.6 0 0 1 8.5-2.4A4.6 4.6 0 0 1 20.5 9Z" />
      <path d="M7 11h2.5l1.5-2.5 2 5 1.5-2.5H17" />
    </>
  ),
  services: (
    <path d="M14.5 6.5a4 4 0 0 0-5.3 5L3.5 17.2V20.5h3.3l5.7-5.7a4 4 0 0 0 5-5.3l-2.4 2.4-2.4-.6-.6-2.4 2.4-2.4Z" />
  ),
  event: <path d="m12 3 2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16l-5.1 2.8L8 13l-4.3-4 5.8-.7L12 3Z" />,
  autre: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
};

export function CategoryIcon({ icon, size = 20 }: { icon: CategoryIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {PATHS[icon] ?? PATHS.autre}
    </svg>
  );
}
