/**
 * OCD Live wordmark, drawn after the studio sign (orange "OCD", "Live" underneath on the right).
 * Replace with the official vector file when Bovann provides it; keep the same props.
 */
export function Logo({
  height = 40,
  tone = 'onDark',
  className,
}: {
  height?: number;
  /** "Live" is white on dark backgrounds and ink on light ones. */
  tone?: 'onDark' | 'onLight';
  className?: string;
}) {
  const live = tone === 'onDark' ? '#ffffff' : '#14151b';
  return (
    <svg
      viewBox="0 0 300 160"
      height={height}
      width={(height * 300) / 160}
      className={className}
      role="img"
      aria-label="OCD Live"
    >
      <g fill="none" stroke="var(--color-brand, #f26b1d)" strokeWidth="24">
        <circle cx="50" cy="50" r="38" />
        <path d="M174.4 20.9A38 38 0 1 0 174.4 79.1" strokeLinecap="butt" />
        <path d="M212 12h30a38 38 0 0 1 0 76h-30z" strokeLinejoin="round" />
      </g>
      <text
        x="292"
        y="154"
        textAnchor="end"
        fill={live}
        fontFamily="Poppins, var(--font-display), sans-serif"
        fontWeight="700"
        fontSize="64"
        letterSpacing="-1.5"
      >
        Live
      </text>
    </svg>
  );
}
