import Link from 'next/link';
import styles from './SiteHeader.module.css';

/** Brand bar shared by every customer screen (approved design, all steps). */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Bovann OCD Live, accueil">
        <span className={styles.liveDot} aria-hidden="true" />
        <span className={styles.name}>Bovann OCD Live</span>
      </Link>
    </header>
  );
}
