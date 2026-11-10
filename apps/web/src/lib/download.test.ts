import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiDownload } from './api';

describe('apiDownload (receipt PDF)', () => {
  it('sends the booking token and returns the file', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('%PDF-1.3', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      );
    const blob = await apiDownload('/bookings/BOV-2611-7KQ4M/receipt', 'tok', fetchImpl);
    expect(await blob.text()).toBe('%PDF-1.3');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/v1/bookings/BOV-2611-7KQ4M/receipt');
    expect((init as RequestInit).headers).toEqual({
      'X-Booking-Token': 'tok',
      'Accept-Language': 'fr',
    });
  });

  it('turns a refusal into the server message, and a network failure into a clear one', async () => {
    const refused = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'RECEIPT_NOT_AVAILABLE', message: 'Pas encore confirmée.' }),
          { status: 409 },
        ),
      );
    await expect(apiDownload('/x', 't', refused)).rejects.toMatchObject({
      status: 409,
      code: 'RECEIPT_NOT_AVAILABLE',
      message: 'Pas encore confirmée.',
    });
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiDownload('/x', 't', offline)).rejects.toBeInstanceOf(ApiError);
  });
});
