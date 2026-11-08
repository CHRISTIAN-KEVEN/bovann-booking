import type { PaymentMethod } from '@bovann/shared';

/**
 * Contract every payment provider adapter implements (see
 * docs/payment-providers-analysis.md). The booking engine only talks to this
 * interface, so the provider (Hub2, FedaPay, PayDunya…) can be chosen, changed
 * or doubled without touching booking logic.
 *
 * Phase 3 ships the mock adapter; Phase 4 adds the real provider, signed
 * webhooks and the reconciliation job.
 */
export interface InitiatePaymentInput {
  paymentId: number;
  /** Stable per attempt: the provider must not charge twice for the same key. */
  idempotencyKey: string;
  amountXof: number;
  method: PaymentMethod;
  /** Mobile money network, e.g. TMONEY or FLOOZ. */
  channel: string | null;
  /** E.164 number charged for mobile money. */
  payerPhone: string | null;
  bookingReference: string;
  description: string;
  customer: { fullName: string; email: string | null; phone: string };
}

export interface InitiatePaymentResult {
  providerRef: string;
  /** Text to show the customer while they approve (e.g. "Validez sur votre téléphone"). */
  instructions: string | null;
  /** Hosted page to open for card payments. */
  redirectUrl: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** The provider could not start the payment (network error, rejected request…). */
export class PaymentProviderError extends Error {}
