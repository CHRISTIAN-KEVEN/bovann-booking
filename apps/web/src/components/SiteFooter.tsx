import Link from 'next/link';
import styles from './SiteFooter.module.css';

/** Links every customer page needs: the conditions and finding a booking. */
export function SiteFooter({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={`${styles.footer} ${dark ? styles.dark : ''}`}>
      <div className={styles.inner}>
        <nav aria-label="Liens utiles" className={styles.links}>
          <Link href="/mes-reservations">Retrouver ma réservation</Link>
          <Link href="/conditions">Conditions de réservation et d’annulation</Link>
        </nav>
        <span className={styles.copy}>© {new Date().getFullYear()} Bovann Group · Lomé, Togo</span>
      </div>
    </footer>
  );
}
