import type { Metadata } from 'next';
import { Body, Screen } from '@/components/ui';
import { Link } from '@/i18n/I18nProvider';
import { serverT } from '@/i18n/server';
import styles from './page.module.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  return { title: serverT((await params).lang)('meta.conditions') };
}

/** Shown on the page so customers can quote it; change it with every edit of the text. */
const VERSION = { fr: '9 novembre 2026', en: '9 November 2026' };
const STUDIO_PHONE = process.env.NEXT_PUBLIC_STUDIO_CONTACT_PHONE;

/** The conditions in the page's language. The French text is the reference. */
export default async function ConditionsPage({ params }: { params: Promise<{ lang: string }> }) {
  return (await params).lang === 'en' ? <ConditionsEn /> : <ConditionsFr />;
}

/**
 * Booking and cancellation conditions accepted at the details step.
 * Cancellation rule decided by the product owner on 2026-11-09 (48 h). To be reviewed by a
 * lawyer before launch.
 */
function ConditionsFr() {
  return (
    <Screen layout="single">
      <Body>
        <article className={styles.doc}>
          <header className={styles.head}>
            <h1>Conditions de réservation et d’annulation</h1>
            <p className={styles.version}>Version du {VERSION.fr}</p>
          </header>

          <section>
            <h2>1. Le service</h2>
            <p>
              OCD Live est un studio de lives exploité par Bovann Group à Lomé (Togo). Il met à
              votre disposition un studio, une régie et une équipe pour réaliser vos lives de vente,
              selon deux formats&nbsp;:
            </p>
            <ul>
              <li>
                <strong>En studio</strong>&nbsp;: vous venez au studio à Lomé.
              </li>
              <li>
                <strong>Virtuel</strong>&nbsp;: vous restez dans votre boutique&nbsp;; notre équipe
                et une assistante animent le live depuis le studio.
              </li>
            </ul>
          </section>

          <section>
            <h2>2. Réservation</h2>
            <ul>
              <li>
                Vous réservez des créneaux de 1h30 ou un forfait. Les prix sont affichés en francs
                CFA (XOF) avant le paiement.
              </li>
              <li>
                En appuyant sur «&nbsp;Payer&nbsp;», vos créneaux sont réservés pour vous quelques
                minutes, le temps du paiement. Sans paiement dans ce délai, ils sont libérés.
              </li>
              <li>
                La réservation est confirmée à la réception du paiement. Vous recevez une référence
                (par exemple BOV-2611-7KQ4M)&nbsp;: gardez-la. Avec votre numéro de téléphone, elle
                vous permet de <Link href="/mes-reservations">retrouver votre réservation</Link> à
                tout moment.
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Paiement</h2>
            <p>
              Le paiement se fait par Mobile Money (T-Money, Flooz) ou par carte bancaire, via notre
              prestataire de paiement. OCD Live ne voit ni ne conserve vos codes secrets ni vos
              numéros de carte.
            </p>
          </section>

          <section>
            <h2>4. Annulation ou changement de date par vous</h2>
            <ul>
              <li>
                <strong>Plus de 48&nbsp;heures avant le début de votre live</strong>&nbsp;:
                contactez le studio. Vous choisissez entre le remboursement intégral du montant payé
                et une nouvelle date, selon les disponibilités.
              </li>
              <li>
                <strong>Moins de 48&nbsp;heures avant</strong>, ou en cas d’absence le jour du
                live&nbsp;: le montant payé n’est pas remboursé.
              </li>
              <li>
                Le remboursement est fait sur le moyen de paiement utilisé, ou sur un autre moyen
                convenu avec vous.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Annulation par le studio</h2>
            <p>
              Si le studio doit annuler votre live (panne, fermeture exceptionnelle…), il vous
              prévient au plus vite et vous rembourse intégralement le montant payé, ou vous propose
              une nouvelle date si vous le préférez.
            </p>
          </section>

          <section>
            <h2>6. Vos données personnelles</h2>
            <ul>
              <li>
                Nous recueillons votre nom, votre téléphone, le nom et le secteur de votre
                entreprise, votre e-mail (facultatif) et la description de votre live.
              </li>
              <li>
                Ces informations servent à gérer votre réservation, à vous contacter à son sujet et
                à préparer votre live. Les informations nécessaires au paiement sont transmises à
                notre prestataire de paiement.
              </li>
              <li>Elles ne sont jamais vendues.</li>
              <li>Pour consulter, corriger ou supprimer vos informations, contactez le studio.</li>
            </ul>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              Studio OCD Live, Bovann Group, Lomé (Togo).
              {STUDIO_PHONE ? (
                <>
                  {' '}
                  Téléphone et WhatsApp&nbsp;:{' '}
                  <a href={`tel:${STUDIO_PHONE.replace(/\s/g, '')}`}>{STUDIO_PHONE}</a>.
                </>
              ) : null}
            </p>
          </section>

          <p className={styles.note}>
            La version applicable à votre réservation est celle en vigueur à la date de votre
            réservation.
          </p>
        </article>
      </Body>
    </Screen>
  );
}

/** English translation. If the two versions differ, the French text applies. */
function ConditionsEn() {
  return (
    <Screen layout="single">
      <Body>
        <article className={styles.doc}>
          <header className={styles.head}>
            <h1>Booking and cancellation terms</h1>
            <p className={styles.version}>Version of {VERSION.en}</p>
          </header>

          <section>
            <h2>1. The service</h2>
            <p>
              OCD Live is a live-streaming studio run by Bovann Group in Lomé (Togo). It provides a
              studio, a control room and a team for your sales lives, in two formats:
            </p>
            <ul>
              <li>
                <strong>In studio</strong>: you come to the studio in Lomé.
              </li>
              <li>
                <strong>Virtual</strong>: you stay in your shop; our team and an assistant run the
                live from the studio.
              </li>
            </ul>
          </section>

          <section>
            <h2>2. Booking</h2>
            <ul>
              <li>
                You book 1h30 slots or a package. Prices are shown in CFA francs (XOF) before
                payment.
              </li>
              <li>
                When you press “Pay”, your slots are held for you for a few minutes while you pay.
                Without payment in that time, they are released.
              </li>
              <li>
                The booking is confirmed when the payment is received. You get a reference (for
                example BOV-2611-7KQ4M): keep it. With your phone number, it lets you{' '}
                <Link href="/mes-reservations">find your booking</Link> at any time.
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Payment</h2>
            <p>
              You pay by Mobile Money (T-Money, Flooz) or bank card, through our payment provider.
              OCD Live never sees or keeps your PINs or card numbers.
            </p>
          </section>

          <section>
            <h2>4. Cancelling or changing the date yourself</h2>
            <ul>
              <li>
                <strong>More than 48 hours before your live starts</strong>: contact the studio. You
                choose between a full refund of the amount paid and a new date, subject to
                availability.
              </li>
              <li>
                <strong>Less than 48 hours before</strong>, or if you don’t come on the day: the
                amount paid is not refunded.
              </li>
              <li>
                The refund is made to the payment method used, or to another method agreed with you.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Cancellation by the studio</h2>
            <p>
              If the studio has to cancel your live (breakdown, exceptional closure…), it tells you
              as soon as possible and refunds the full amount paid, or offers you a new date if you
              prefer.
            </p>
          </section>

          <section>
            <h2>6. Your personal data</h2>
            <ul>
              <li>
                We collect your name, your phone number, your business name and line of business,
                your email (optional) and the description of your live.
              </li>
              <li>
                This information is used to manage your booking, contact you about it and prepare
                your live. The information needed for payment is passed to our payment provider.
              </li>
              <li>It is never sold.</li>
              <li>To see, correct or delete your information, contact the studio.</li>
            </ul>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              OCD Live studio, Bovann Group, Lomé (Togo).
              {STUDIO_PHONE ? (
                <>
                  {' '}
                  Phone and WhatsApp:{' '}
                  <a href={`tel:${STUDIO_PHONE.replace(/\s/g, '')}`}>{STUDIO_PHONE}</a>.
                </>
              ) : null}
            </p>
          </section>

          <p className={styles.note}>
            The version that applies to your booking is the one in force on the day you booked. This
            is a translation: if it differs from the French text, the French text applies.
          </p>
        </article>
      </Body>
    </Screen>
  );
}
