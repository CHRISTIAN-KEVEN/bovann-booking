import { AFRICA_PATH, AFRICA_POINTS, AFRICA_VIEWBOX } from './africa-map-data';
import styles from './AfricaMap.module.css';

type City = Exclude<keyof typeof AFRICA_POINTS, 'lome'>;

/** Cities the lives reach, linked to the studio in Lomé by dotted arcs. */
const REACH: City[] = [
  'dakar',
  'bamako',
  'abidjan',
  'casablanca',
  'cairo',
  'douala',
  'bangui',
  'kinshasa',
  'addis',
  'nairobi',
  'johannesburg',
];

/** Curved line from Lomé to a city, bulging to the left of the direction of travel. */
function arc(to: readonly [number, number]): string {
  const [x1, y1] = AFRICA_POINTS.lome;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const bend = 0.22;
  return `M${x1} ${y1}Q${(mx + dy * bend).toFixed(1)} ${(my - dx * bend).toFixed(1)} ${x2} ${y2}`;
}

/** Decorative glowing map of Africa: "the studio is in Lomé, your audience is everywhere". */
export function AfricaMap({ className }: { className?: string }) {
  const [lx, ly] = AFRICA_POINTS.lome;
  return (
    <svg
      viewBox={AFRICA_VIEWBOX}
      className={`${styles.map} ${className ?? ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={AFRICA_PATH} className={styles.land} />
      <g className={styles.extras}>
        {REACH.map((c, i) => (
          <path
            key={c}
            d={arc(AFRICA_POINTS[c])}
            className={styles.arc}
            style={{ animationDelay: `${-i * 0.7}s` }}
          />
        ))}
      </g>
      {REACH.map((c) => (
        <circle
          key={c}
          cx={AFRICA_POINTS[c][0]}
          cy={AFRICA_POINTS[c][1]}
          r="4"
          className={styles.city}
        />
      ))}
      <circle cx={lx} cy={ly} r="9" className={styles.pulse} />
      <circle cx={lx} cy={ly} r="7" className={styles.studio} />
      <g transform={`translate(${lx - 62} ${ly + 16})`} className={styles.extras}>
        <rect width="124" height="28" rx="14" className={styles.labelBg} />
        <text x="62" y="19" textAnchor="middle" className={styles.label}>
          LOMÉ · STUDIO
        </text>
      </g>
    </svg>
  );
}
