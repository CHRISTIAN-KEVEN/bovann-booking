import { Icon } from './icons';
import styles from './LiveScene.module.css';

/**
 * Decorative home-page scene: a phone showing a live sale in progress, in front of a studio ring
 * light, with the booked slot that made it happen. Hidden from screen readers (it carries no
 * information the page text doesn't).
 */
export function LiveScene({ className }: { className?: string }) {
  return (
    <div className={`${styles.scene} ${className ?? ''}`} aria-hidden="true">
      <div className={styles.ring} />

      <div className={styles.phone}>
        <div className={styles.screen}>
          <div className={styles.topbar}>
            <span className={styles.onAir}>
              <span className={styles.onAirDot} />
              EN DIRECT
            </span>
            <span className={styles.viewers}>
              <Icon name="users" size={10} />1 248
            </span>
          </div>

          <div className={styles.set}>
            <div className={styles.host}>
              <span className={styles.head} />
              <span className={styles.body} />
            </div>
            <div className={styles.rack}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.productTag}>
              <strong>Robe wax</strong>
              <span>12 000 F</span>
            </div>
          </div>

          <div className={styles.comments}>
            <p>
              <b>Aïcha</b> Elle existe en taille M&nbsp;?
            </p>
            <p>
              <b>Koffi</b> J’en prends deux&nbsp;!
            </p>
            <p>
              <b>Mawuli</b> Vous livrez à Kara&nbsp;?
            </p>
          </div>

          <div className={styles.bar}>
            <span className={styles.input}>Écrire un commentaire…</span>
            <span className={styles.buy}>Commander</span>
          </div>
        </div>
      </div>

      <div className={styles.hearts}>
        <span />
        <span />
        <span />
      </div>

      <div className={styles.ticket}>
        <span className={styles.ticketIcon}>
          <Icon name="check" size={16} strokeWidth={3} />
        </span>
        <span className={styles.ticketText}>
          <strong>Créneau confirmé</strong>
          <span>Samedi · 14:00 – 15:30 · En studio</span>
        </span>
      </div>
    </div>
  );
}
