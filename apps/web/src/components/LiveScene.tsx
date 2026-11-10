'use client';

import { useI18n } from '@/i18n/I18nProvider';
import { Icon } from './icons';
import styles from './LiveScene.module.css';

/**
 * Decorative home-page scene: a phone showing a live sale in progress, in front of a studio ring
 * light, with the booked slot that made it happen. Hidden from screen readers (it carries no
 * information the page text doesn't).
 */
export function LiveScene({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`${styles.scene} ${className ?? ''}`} aria-hidden="true">
      <div className={styles.ring} />

      <div className={styles.phone}>
        <div className={styles.screen}>
          <div className={styles.topbar}>
            <span className={styles.onAir}>
              <span className={styles.onAirDot} />
              {t('scene.live')}
            </span>
            <span className={styles.viewers}>
              <Icon name="users" size={10} />
              {t('scene.viewers')}
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
              <strong>{t('scene.product')}</strong>
              <span>{t('scene.price')}</span>
            </div>
          </div>

          <div className={styles.comments}>
            <p>
              <b>Aïcha</b> {t('scene.c1')}
            </p>
            <p>
              <b>Koffi</b> {t('scene.c2')}
            </p>
            <p>
              <b>Mawuli</b> {t('scene.c3')}
            </p>
          </div>

          <div className={styles.bar}>
            <span className={styles.input}>{t('scene.comment')}</span>
            <span className={styles.buy}>{t('scene.buy')}</span>
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
          <strong>{t('scene.confirmed')}</strong>
          <span>{t('scene.confirmedText')}</span>
        </span>
      </div>
    </div>
  );
}
