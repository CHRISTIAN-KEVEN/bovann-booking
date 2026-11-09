import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '@/components/FlowProvider';
import { ReservationRecap } from '@/components/ReservationRecap';
import { ModeChooser } from './ModeChooser';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const space = vi.fn();
const packages = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { space: () => space(), packages: (m: string) => packages(m) },
  ApiError: class extends Error {},
}));

function spaceWith(modes: string[]) {
  return { slug: 's', name: 'Studio', address: null, slotDurationMin: 90, modes };
}

const FLOW_KEY = 'bovann.booking-flow.v1';

describe('Home page', () => {
  beforeEach(() => {
    push.mockClear();
    sessionStorage.clear();
    space.mockResolvedValue(spaceWith(['IN_PERSON', 'VIRTUAL']));
    packages.mockImplementation((m: string) =>
      Promise.resolve({ unitPriceXof: m === 'VIRTUAL' ? 12000 : 15000, packages: [] }),
    );
  });

  it('opens the calendar in one tap on a mode, and remembers the mode', async () => {
    render(
      <FlowProvider>
        <ModeChooser />
      </FlowProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Virtuel/ }));
    expect(push).toHaveBeenCalledWith('/reserver/date');
    expect(JSON.parse(sessionStorage.getItem(FLOW_KEY)!).mode).toBe('VIRTUAL');
  });

  it('shows each mode with its own starting price, and the slot length', async () => {
    render(
      <FlowProvider>
        <ModeChooser />
      </FlowProvider>,
    );
    const studio = await screen.findByRole('button', { name: /En studio/ });
    await within(studio).findByText(/15[\s\u202f\u00a0]000/);
    expect(
      within(screen.getByRole('button', { name: /Virtuel/ })).getByText(/12[\s\u202f\u00a0]000/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lives de 1h30/)).toBeInTheDocument();
  });

  it('offers only the modes the studio opens', async () => {
    space.mockResolvedValue(spaceWith(['IN_PERSON']));
    render(
      <FlowProvider>
        <ModeChooser />
      </FlowProvider>,
    );
    await screen.findByText(/15[\s\u202f\u00a0]000/);
    const choices = screen.getByRole('region', { name: /Comment voulez-vous faire votre live/ });
    expect(within(choices).getByRole('button', { name: /En studio/ })).toBeInTheDocument();
    expect(within(choices).queryByRole('button', { name: /Virtuel/ })).toBeNull();
  });
});

describe('Desktop recap panel', () => {
  beforeEach(() => {
    sessionStorage.setItem(
      FLOW_KEY,
      JSON.stringify({
        mode: 'IN_PERSON',
        date: '2026-11-12',
        selection: { type: 'SLOTS', slotStarts: ['2026-11-12T08:00:00.000Z'] },
        summary: {
          label: '1 créneau',
          timesLabel: '08:00 – 09:30',
          slotCount: 1,
          listPriceXof: 15000,
          discountXof: 0,
          totalXof: 15000,
        },
      }),
    );
  });

  it('lists only the choices made before the current step', async () => {
    render(
      <FlowProvider>
        <ReservationRecap step={3} />
      </FlowProvider>,
    );
    expect(await screen.findByText('En studio')).toBeInTheDocument();
    expect(screen.getByText(/12 novembre/)).toBeInTheDocument();
    expect(screen.queryByText('08:00 – 09:30')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('shows the selection and total later, without edit links once locked', async () => {
    render(
      <FlowProvider>
        <ReservationRecap step={5} locked />
      </FlowProvider>,
    );
    expect(await screen.findByText('08:00 – 09:30')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull();
  });
});
