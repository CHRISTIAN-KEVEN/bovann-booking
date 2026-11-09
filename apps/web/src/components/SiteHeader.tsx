import Link from 'next/link';
import { Logo } from './Logo';
import styles from './SiteHeader.module.css';

/** Brand bar shared by every customer screen, full width on every device. */
export function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  return (
    <header className={`${styles.header} ${transparent ? styles.transparent : ''}`}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="OCD Live par Bovann, accueil">
          <Logo height={44} className={styles.logo} />
          <span className={styles.by}>par Bovann</span>
        </Link>
        <span className={styles.place}>
          <span className={styles.liveDot} aria-hidden="true" />
          Studio · Lomé, Togo
        </span>
      </div>
    </header>
  );
}
