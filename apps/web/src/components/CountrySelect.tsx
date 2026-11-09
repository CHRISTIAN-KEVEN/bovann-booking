import { COUNTRY_CODES, flagOf } from '@/lib/details';
import { Icon } from './icons';
import styles from './CountrySelect.module.css';

/**
 * Country picker for phone numbers. The list shows "🇹🇬 Togo (+228)"; the closed field stays
 * compact ("🇹🇬 +228") so the number keeps its room on phones. It is the native select (invisible,
 * on top of the compact view), so it keeps the phone's own picker and works with screen readers.
 */
export function CountrySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const current = COUNTRY_CODES.find((c) => c.code === value) ?? COUNTRY_CODES[0];
  return (
    <span className={`${styles.wrap} ${className ?? ''}`}>
      <span className={styles.display} aria-hidden="true">
        <span className={styles.flag}>{flagOf(current.iso)}</span>
        {current.code}
        <Icon name="chevronDown" size={16} className={styles.chevron} />
      </span>
      <select
        className={styles.select}
        aria-label={`Pays de votre numéro : ${current.name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.code} value={c.code}>
            {flagOf(c.iso)} {c.name} ({c.code})
          </option>
        ))}
      </select>
    </span>
  );
}
