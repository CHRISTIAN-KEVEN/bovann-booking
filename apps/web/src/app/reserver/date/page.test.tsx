import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '@/components/FlowProvider';
import DatePage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const space = vi.fn();
const month = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { space: () => space(), month: (m: string) => month(m) },
  ApiError: class extends Error {},
}));

const FLOW_KEY = 'bovann.booking-flow.v1';

function days(statuses: Record<string, string>) {
  return Array.from({ length: 30 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, '0')}`;
    const status = statuses[date] ?? 'PAST';
    return { date, status, availableCount: status === 'AVAILABLE' ? 9 : 0 };
  });
}

function renderPage(flow: object) {
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  return render(
    <FlowProvider>
      <DatePage />
    </FlowProvider>,
  );
}

describe('Date step', () => {
  beforeEach(() => {
    push.mockClear();
    sessionStorage.clear();
    space.mockResolvedValue({
      slug: 's',
      name: 'Studio',
      modes: ['IN_PERSON'],
      booking: { today: '2026-11-10', lastBookableDate: '2027-02-07' },
    });
    month.mockResolvedValue({
      month: '2026-11',
      days: days({ '2026-11-12': 'AVAILABLE', '2026-11-13': 'FULL' }),
    });
  });

  it('opens the slots of a day in one tap, with no extra button', async () => {
    renderPage({ mode: 'IN_PERSON' });
    await userEvent.click(await screen.findByRole('button', { name: /12 novembre/ }));
    expect(push).toHaveBeenCalledWith('/reserver/creneaux');
    expect(JSON.parse(sessionStorage.getItem(FLOW_KEY)!).date).toBe('2026-11-12');
    expect(screen.queryByRole('button', { name: /Voir les créneaux/ })).toBeNull();
  });

  it('does nothing on a full day', async () => {
    renderPage({ mode: 'IN_PERSON' });
    const full = await screen.findByRole('button', { name: /13 novembre.*complet/ });
    expect(full).toBeDisabled();
    await userEvent.click(full);
    expect(push).not.toHaveBeenCalled();
  });

  it('marks the date chosen earlier, and keeps its slots when it is opened again', async () => {
    const selection = { type: 'SLOTS', slotStarts: ['2026-11-12T08:00:00.000Z'] };
    renderPage({ mode: 'IN_PERSON', date: '2026-11-12', selection });
    const day = await screen.findByRole('button', { name: /12 novembre/ });
    expect(day).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(day);
    expect(JSON.parse(sessionStorage.getItem(FLOW_KEY)!).selection).toEqual(selection);
  });
});
