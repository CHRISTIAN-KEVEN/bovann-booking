import { renderI18n } from '@/test/i18n';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '@/components/FlowProvider';
import DetailsPage from './page';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push, replace }),
}));

function seedFlow() {
  sessionStorage.setItem(
    'bovann.booking-flow.v2',
    JSON.stringify({
      mode: 'IN_PERSON',
      date: '2026-11-12',
      selection: { type: 'PACKAGE', packageCode: 'PACK_6H', start: '2026-11-12T12:30:00.000Z' },
      summary: {
        packageName: 'Pack 6h',
        timesLabel: '12:30 – 18:30',
        slotCount: 4,
        listPriceXof: 60000,
        discountXof: 9000,
        totalXof: 51000,
      },
    }),
  );
}

describe('Screen 4: customer details', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
  });

  it('sends the customer back to the slots if nothing was chosen yet', async () => {
    sessionStorage.setItem(
      'bovann.booking-flow.v2',
      JSON.stringify({ mode: 'IN_PERSON', date: '2026-11-12' }),
    );
    renderI18n(
      <FlowProvider>
        <DetailsPage />
      </FlowProvider>,
    );
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/reserver/creneaux'));
  });

  it('shows the selection recap and French errors for missing fields', async () => {
    seedFlow();
    renderI18n(
      <FlowProvider>
        <DetailsPage />
      </FlowProvider>,
    );
    expect(await screen.findByText(/Pack 6h · 51 000 FCFA/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Passer au paiement' }));
    expect(screen.getByText('Indiquez votre nom complet.')).toBeInTheDocument();
    expect(
      screen.getByText('Vous devez accepter les conditions de réservation.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom complet/)).toHaveAttribute('aria-invalid', 'true');
    expect(push).not.toHaveBeenCalled();
  });

  it('saves valid details (email optional) and moves to payment', async () => {
    seedFlow();
    renderI18n(
      <FlowProvider>
        <DetailsPage />
      </FlowProvider>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nom complet/), 'Afi Mensah');
    await user.type(screen.getByLabelText(/Téléphone/), '90 12 34 56');
    await user.type(screen.getByLabelText(/Nom de l’entreprise/), 'Boutique Afi Mode');
    await user.selectOptions(screen.getByLabelText(/Secteur d’activité/), 'Mode & beauté');
    await user.click(screen.getByLabelText(/J’accepte les conditions/));
    await user.click(screen.getByRole('button', { name: 'Passer au paiement' }));

    expect(push).toHaveBeenCalledWith('/reserver/paiement');
    const saved = JSON.parse(sessionStorage.getItem('bovann.booking-flow.v2')!);
    expect(saved.details).toMatchObject({
      fullName: 'Afi Mensah',
      phone: '+22890123456',
      email: '',
      acceptTerms: true,
    });
  });
});
