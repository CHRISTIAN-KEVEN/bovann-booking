import { formatXof } from '@bovann/shared';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './page.module.css';

/**
 * Landing hero from the approved design (screen 1, top part).
 * The interactive booking flow (mode → date → slots → details → payment)
 * is delivered in Phase 3; until then this page states it honestly.
 */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <section className={styles.hero}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          STUDIO LIVE · LOMÉ
        </span>
        <h1 className={styles.title}>Réservez votre session live</h1>
        <p className={styles.lead}>
          Choisissez une date, un créneau de 1h30 ou un forfait, et payez en ligne. En studio à Lomé
          ou en virtuel.
        </p>
      </section>
      <main className={styles.main}>
        <p className={styles.price}>
          À partir de <strong>{formatXof(15000)}</strong> le créneau de 1h30
        </p>
        <p className={styles.notice} role="status">
          La réservation en ligne ouvre très bientôt.
        </p>
      </main>
    </>
  );
}
