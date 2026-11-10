import type { ReactNode } from 'react';
import styles from './Flag.module.css';

/**
 * Country flags drawn in SVG (simplified, 3:2). Emoji flags are not used here: Windows shows
 * them as two letters, and visitors who read little rely on the flag to recognise their country.
 * A country without a drawing shows its two-letter code.
 */
const star = (cx: number, cy: number, r: number, fill: string) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
  return <polygon points={points} fill={fill} />;
};

const vertical = (a: string, b: string, c: string, extra?: ReactNode) => (
  <>
    <rect width="16" height="32" fill={a} />
    <rect x="16" width="16" height="32" fill={b} />
    <rect x="32" width="16" height="32" fill={c} />
    {extra}
  </>
);

const horizontal = (a: string, b: string, c: string, extra?: ReactNode) => (
  <>
    <rect width="48" height="10.67" fill={a} />
    <rect y="10.67" width="48" height="10.67" fill={b} />
    <rect y="21.33" width="48" height="10.67" fill={c} />
    {extra}
  </>
);

const FLAGS: Record<string, ReactNode> = {
  TG: (
    <>
      <rect width="48" height="32" fill="#006a4e" />
      <rect y="6.4" width="48" height="6.4" fill="#ffce00" />
      <rect y="19.2" width="48" height="6.4" fill="#ffce00" />
      <rect width="19.2" height="19.2" fill="#d21034" />
      {star(9.6, 9.8, 5.2, '#ffffff')}
    </>
  ),
  BJ: (
    <>
      <rect width="48" height="16" fill="#fcd116" />
      <rect y="16" width="48" height="16" fill="#e8112d" />
      <rect width="19.2" height="32" fill="#008751" />
    </>
  ),
  CI: vertical('#f77f00', '#ffffff', '#009e60'),
  GH: horizontal('#ce1126', '#fcd116', '#006b3f', star(24, 16.3, 5, '#000000')),
  SN: vertical('#00853f', '#fdef42', '#e31b23', star(24, 16.3, 4.4, '#00853f')),
  NG: vertical('#008751', '#ffffff', '#008751'),
  CM: vertical('#007a5e', '#ce1126', '#fcd116', star(24, 16.3, 4.4, '#fcd116')),
  BF: (
    <>
      <rect width="48" height="16" fill="#ef2b2d" />
      <rect y="16" width="48" height="16" fill="#009e49" />
      {star(24, 16.3, 4.4, '#fcd116')}
    </>
  ),
  NE: horizontal(
    '#e05206',
    '#ffffff',
    '#0db02b',
    <circle cx="24" cy="16" r="3.6" fill="#e05206" />,
  ),
  ML: vertical('#14b53a', '#fcd116', '#ce1126'),
  GN: vertical('#ce1126', '#fcd116', '#009460'),
  GA: horizontal('#009e60', '#fcd116', '#3a75c4'),
  CG: (
    <>
      <rect width="48" height="32" fill="#fbde4a" />
      <polygon points="0,0 32,0 0,32" fill="#009543" />
      <polygon points="48,0 48,32 16,32" fill="#dc241f" />
    </>
  ),
  CD: (
    <>
      <rect width="48" height="32" fill="#007fff" />
      <polygon points="0,26 39,0 48,0 48,6 9,32 0,32" fill="#f7d618" />
      <polygon points="0,28.5 42.8,0 48,0 48,3.5 5.2,32 0,32" fill="#ce1021" />
      {star(8, 7.5, 5, '#f7d618')}
    </>
  ),
  FR: vertical('#002395', '#ffffff', '#ed2939'),
  US: (
    <>
      <rect width="48" height="32" fill="#ffffff" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} y={i * 4.92} width="48" height="2.46" fill="#b22234" />
      ))}
      <rect width="20" height="17.2" fill="#3c3b6e" />
    </>
  ),
};

export function Flag({ code, width = 26 }: { code: string; width?: number }) {
  const drawing = FLAGS[code];
  return (
    <span className={styles.flag} style={{ width, height: (width * 2) / 3 }} aria-hidden="true">
      {drawing ? (
        <svg viewBox="0 0 48 32" width="100%" height="100%" preserveAspectRatio="none">
          {drawing}
        </svg>
      ) : (
        <span className={styles.code}>{code}</span>
      )}
    </span>
  );
}
